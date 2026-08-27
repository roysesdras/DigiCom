require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('crypto');

const { exec } = require('child_process');
const db = require('./database');
const pushService = require('./push-service');
const { performBackup } = require('./backup-db');

const JWT_SECRET = process.env.JWT_SECRET || 'digicom_ultra_secure_jwt_key_prod_2026';
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

// Uploads directory in persistent storage
const uploadsDir = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Remote Storage Configuration (Option 2 - SFTP / SSH)
const STORAGE_HOST = process.env.STORAGE_HOST || '162.35.166.27';
const STORAGE_USER = process.env.STORAGE_USER || 'root';
const STORAGE_REMOTE_PATH = process.env.STORAGE_REMOTE_PATH || '/root/storage_digicom/uploads';
const STORAGE_SSH_KEY = process.env.STORAGE_SSH_KEY || '/root/.ssh/id_ed25519_digicom';

function syncFileToRemoteStorage(filePath) {
  const sshOption = `-i ${STORAGE_SSH_KEY} -o StrictHostKeyChecking=no`;
  const cmd = `rsync -avz -e "ssh ${sshOption}" "${filePath}" ${STORAGE_USER}@${STORAGE_HOST}:${STORAGE_REMOTE_PATH}/`;
  exec(cmd, (err) => {
    if (err) {
      console.error('[-] Remote storage sync error for', path.basename(filePath), ':', err.message);
    } else {
      console.log('[+] Synced to remote storage:', path.basename(filePath));
    }
  });
}

function fetchFileFromRemoteStorage(fileName, localTarget) {
  return new Promise((resolve, reject) => {
    const sshOption = `-i ${STORAGE_SSH_KEY} -o StrictHostKeyChecking=no`;
    const cmd = `rsync -avz -e "ssh ${sshOption}" ${STORAGE_USER}@${STORAGE_HOST}:${STORAGE_REMOTE_PATH}/"${fileName}" "${localTarget}"`;
    exec(cmd, (err) => {
      if (err) return reject(err);
      resolve(localTarget);
    });
  });
}

// Schedule daily automated encrypted database backup (every 24h)
setInterval(() => {
  performBackup().catch(err => console.error('[-] Scheduled backup error:', err));
}, 24 * 60 * 60 * 1000);

// Socket.io with permissive CORS for standalone widget integration
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors({
  origin: true,
  credentials: true
}));
const compression = require('compression');
app.use(compression());

app.use(express.json());
app.use(cookieParser());

// Static Files with ETag Revalidation for Instant 304 Live Updates (0 KB payload when unchanged)
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
  }
}));
app.use('/widget', express.static(path.join(__dirname, '..', 'widget'), { maxAge: '1y', etag: true }));
app.get('/uploads/:filename', async (req, res) => {
  const fileName = path.basename(req.params.filename);
  const localFile = path.join(uploadsDir, fileName);

  if (!fs.existsSync(localFile)) {
    try {
      console.log('[+] File missing locally, fetching on-demand from remote storage VPS:', fileName);
      await fetchFileFromRemoteStorage(fileName, localFile);
    } catch (err) {
      console.error('[-] Failed to fetch remote file:', err.message);
      return res.status(404).send('File not found');
    }
  }

  if (fs.existsSync(localFile)) {
    return res.sendFile(localFile);
  } else {
    return res.status(404).send('File not found');
  }
});

// Auth Middleware Helper
function authenticateToken(req, res, next) {
  let token = req.cookies && req.cookies.digicom_token;
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Non authentifié' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Session invalide ou expirée' });
    req.user = user;
    next();
  });
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, displayName: user.display_name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// ---------------- REST API ROUTES ----------------

// 1. Initial State & Setup Status
app.get('/api/status', async (req, res) => {
  try {
    const count = await db.getUserCount();
    res.json({
      initialized: count > 0,
      appName: 'DigiCom',
      vapidPublicKey: pushService.getPublicKey()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Initial Setup (Create first Admin)
app.post('/api/setup', async (req, res) => {
  try {
    const count = await db.getUserCount();
    if (count > 0) {
      return res.status(400).json({ error: 'DigiCom est déjà initialisé. Veuillez vous connecter.' });
    }

    const { username, displayName, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: 'Identifiant et mot de passe (min 6 caractères) requis.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = 'admin_' + Date.now();
    await db.createUser({
      id: userId,
      username,
      displayName: displayName || username,
      passwordHash,
      role: 'admin'
    });

    const user = { id: userId, username, display_name: displayName || username, role: 'admin' };
    const token = generateToken(user);

    res.cookie('digicom_token', token, {
      httpOnly: true,
      secure: false, // works behind Traefik HTTPS reverse proxy
      sameSite: 'lax',
      path: '/',
      maxAge: 90 * 24 * 60 * 60 * 1000
    });

    res.json({ success: true, user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Veuillez saisir votre nom d\'utilisateur et mot de passe.' });
    }

    const user = await db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const token = generateToken(user);
    res.cookie('digicom_token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 90 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role
      },
      token
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3b. Public Self Registration Endpoint
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, displayName, password, inviteUsername } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Veuillez renseigner un identifiant et un mot de passe.' });
    }
    const cleanUsername = username.toLowerCase().trim().replace(/[^a-z0-9_.-]/g, '');
    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: 'L\'identifiant doit contenir au moins 3 caractères (lettres, chiffres, _.-).' });
    }

    const existing = await db.getUserByUsername(cleanUsername);
    if (existing) {
      return res.status(400).json({ error: 'Cet identifiant est déjà pris. Veuillez en choisir un autre.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    await db.createUser({
      id: userId,
      username: cleanUsername,
      displayName: displayName || cleanUsername,
      passwordHash,
      role: 'family'
    });

    const newUser = await db.getUserById(userId);

    // Auto-link contact if registration came from an invite link
    if (inviteUsername) {
      const cleanInvite = String(inviteUsername).toLowerCase().trim().replace(/^@/, '');
      const inviter = await db.getUserByUsername(cleanInvite);
      if (inviter && inviter.id !== userId) {
        await db.addContact(userId, inviter.id);
        io.to(`user_${inviter.id}`).emit('contact_added', { contact: newUser });
        io.to(`user_${userId}`).emit('contact_added', { contact: inviter });
      }
    }

    const token = generateToken(newUser);
    res.cookie('digicom_token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 90 * 24 * 60 * 60 * 1000
    });

    res.json({
      success: true,
      user: {
        id: newUser.id,
        username: newUser.username,
        displayName: newUser.display_name,
        role: newUser.role
      },
      token
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3c. Contact Management Endpoints (Admin Restricted for Sovereign Directory Protection)
app.get('/api/contacts/search', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    const query = req.query.q || '';
    if (!query.trim()) {
      return res.json({ users: [] });
    }
    const users = await db.searchUsers(query, req.user.id);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contacts/add', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'ID contact requis' });

    const targetUser = await db.getUserById(contactId);
    if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable' });

    await db.addContact(req.user.id, contactId);

    // Notify both users via Socket.io
    io.to(`user_${req.user.id}`).emit('contact_added', { contact: targetUser });
    const currentUser = await db.getUserById(req.user.id);
    io.to(`user_${contactId}`).emit('contact_added', { contact: currentUser });

    res.json({ success: true, contact: targetUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contacts/accept-invite', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Nom d\'utilisateur requis' });

    const cleanUsername = username.trim().replace(/^@/, '');
    const targetUser = await db.getUserByUsername(cleanUsername);
    if (!targetUser) return res.status(404).json({ error: 'Utilisateur introuvable' });

    if (targetUser.id === req.user.id) {
      return res.json({ success: true, contact: targetUser });
    }

    await db.addContact(req.user.id, targetUser.id);
    await db.addContact(targetUser.id, req.user.id);

    // Notify both users via Socket.io
    io.to(`user_${req.user.id}`).emit('contact_added', { contact: targetUser });
    const currentUser = await db.getUserById(req.user.id);
    io.to(`user_${targetUser.id}`).emit('contact_added', { contact: currentUser });

    res.json({ success: true, contact: targetUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/contacts/:contactId', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    await db.removeContact(req.user.id, contactId);
    io.to(`user_${req.user.id}`).emit('contact_removed', { contactId });
    io.to(`user_${contactId}`).emit('contact_removed', { contactId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3d. Salons (Confidential Group Workspaces) Endpoints
app.get('/api/salons', authenticateToken, async (req, res) => {
  try {
    const salons = await db.getSalonsForUser(req.user.id);
    res.json({ salons });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/create', authenticateToken, async (req, res) => {
  try {
    const { name, description, icon, memberIds = [] } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom du Salon est obligatoire' });
    }
    const salonId = 'salon_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const salon = await db.createSalon({
      id: salonId,
      name: name.trim(),
      description: description ? description.trim() : '',
      icon: icon || '🛡️',
      created_by: req.user.id,
      memberIds: Array.isArray(memberIds) ? memberIds : []
    });

    // Fetch members to send notifications & socket events
    const members = await db.getSalonMembers(salonId);
    const formattedSalonName = '#' + (salon.name || '').replace(/^#+/, '');

    members.forEach(m => {
      io.to(`user_${m.id}`).emit('salon_created', { salon });

      // Auto-join active connected sockets to this salon room
      if (onlineUsers.has(m.id)) {
        const userSockets = onlineUsers.get(m.id);
        userSockets.forEach(sockId => {
          const s = io.sockets.sockets.get(sockId);
          if (s) s.join(`salon_${salonId}`);
        });
      }

      // Web Push for invited members (except creator)
      if (m.id !== req.user.id) {
        pushService.sendNotificationToUser(m.id, {
          title: `Nouveau Salon : ${formattedSalonName}`,
          body: `${req.user.displayName || req.user.username} vous a ajouté au Salon "${formattedSalonName}".`,
          icon: '/img/icon-192.png',
          badge: '/img/badge-72.png',
          data: { url: `/?salon=${salonId}`, channel: 'salon', salonId: salonId }
        }).catch(e => console.error('[-] Push error for salon creation:', e));
      }
    });

    res.json({ success: true, salon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/salons/:id/messages', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const isMember = await db.getSalonMembers(id);
    if (!isMember.some(m => m.id === req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès non autorisé à ce Salon' });
    }
    const messages = await db.getSalonMessages(id);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/salons/:id/members', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const members = await db.getSalonMembers(id);
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/salons/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, icon } = req.body;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Seul le créateur ou l\'administrateur peut modifier ce Salon' });
    }

    let updatedSalon = null;
    if (name && name.trim()) {
      const cleanName = name.trim().replace(/^#+/, '');
      updatedSalon = await db.updateSalonInfo(id, {
        name: cleanName,
        description: description !== undefined ? description.trim() : '',
        icon: icon || '🛡️'
      });
    }

    const formattedSalonName = '#' + (updatedSalon ? updatedSalon.name : (name || '')).replace(/^#+/, '');
    io.to(`salon_${id}`).emit('salon_updated', {
      salonId: id,
      salon: updatedSalon,
      name: updatedSalon ? updatedSalon.name : name,
      formattedName: formattedSalonName,
      description: updatedSalon ? updatedSalon.description : description
    });

    res.json({ success: true, salon: updatedSalon });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new members to existing salon
app.post('/api/salons/:id/members/add', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { memberIds = [] } = req.body;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Seul le créateur ou l\'administrateur peut ajouter des membres' });
    }

    const salon = await db.getSalonById(id);
    if (!salon) return res.status(404).json({ error: 'Salon introuvable' });
    const formattedSalonName = '#' + (salon.name || '').replace(/^#+/, '');

    const currentMembers = await db.getSalonMembers(id);
    const currentIds = currentMembers.map(m => m.id);

    for (const uid of memberIds) {
      if (!currentIds.includes(uid)) {
        await db.addSalonMember(id, uid, 'member');
        io.to(`user_${uid}`).emit('salon_invited', { salonId: id, salon });

        if (onlineUsers.has(uid)) {
          const userSockets = onlineUsers.get(uid);
          userSockets.forEach(sockId => {
            const s = io.sockets.sockets.get(sockId);
            if (s) s.join(`salon_${id}`);
          });
        }

        pushService.sendNotificationToUser(uid, {
          title: `Ajouté au Salon : ${formattedSalonName}`,
          body: `${req.user.displayName || req.user.username} vous a ajouté au Salon "${formattedSalonName}".`,
          icon: '/img/icon-192.png',
          badge: '/img/badge-72.png',
          data: { url: `/?salon=${id}`, channel: 'salon', salonId: id }
        }).catch(e => console.error('[-] Push error:', e));
      }
    }

    io.to(`salon_${id}`).emit('salon_updated', { salonId: id });
    const members = await db.getSalonMembers(id);
    res.json({ success: true, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a member from the salon
app.delete('/api/salons/:id/members/:userId', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Seul le créateur ou l\'administrateur peut retirer des membres' });
    }

    const salon = await db.getSalonById(id);
    if (!salon) return res.status(404).json({ error: 'Salon introuvable' });
    if (salon.created_by === userId) {
      return res.status(400).json({ error: 'Le créateur du Salon ne peut pas être retiré' });
    }

    await db.removeSalonMember(id, userId);

    // Notify removed user
    io.to(`user_${userId}`).emit('salon_deleted', { salonId: id });

    // Remove user socket(s) from salon room
    if (onlineUsers.has(userId)) {
      const userSockets = onlineUsers.get(userId);
      userSockets.forEach(sockId => {
        const s = io.sockets.sockets.get(sockId);
        if (s) s.leave(`salon_${id}`);
      });
    }

    io.to(`salon_${id}`).emit('salon_updated', { salonId: id });
    const members = await db.getSalonMembers(id);
    res.json({ success: true, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Block/Unblock a member in the salon
app.post('/api/salons/:id/members/:userId/block', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { blocked } = req.body;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Seul le créateur ou l\'administrateur peut bloquer des membres' });
    }

    const salon = await db.getSalonById(id);
    if (!salon) return res.status(404).json({ error: 'Salon introuvable' });
    if (salon.created_by === userId) {
      return res.status(400).json({ error: 'Impossible de bloquer le créateur du Salon' });
    }

    const isBlocked = Boolean(blocked);
    await db.blockSalonMember(id, userId, isBlocked ? 1 : 0);

    io.to(`user_${userId}`).emit('salon_member_blocked_status', { salonId: id, isBlocked });
    io.to(`salon_${id}`).emit('salon_updated', { salonId: id });

    const members = await db.getSalonMembers(id);
    res.json({ success: true, is_blocked: isBlocked ? 1 : 0, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/salons/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Seul le créateur ou l\'administrateur peut supprimer ce Salon' });
    }
    const members = await db.getSalonMembers(id);
    await db.deleteSalon(id);

    members.forEach(m => {
      io.to(`user_${m.id}`).emit('salon_deleted', { salonId: id });
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Me
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const user = await db.getUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const token = generateToken(user);
    res.cookie('digicom_token', token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 90 * 24 * 60 * 60 * 1000
    });
    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('digicom_token');
  res.json({ success: true });
});

// 6. Users List & User Creation (Admin only)
app.get('/api/users', authenticateToken, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Action réservée à l\'administrateur.' });
    }

    const { username, displayName, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
    }

    const existing = await db.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ error: 'Cet identifiant existe déjà.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = 'user_' + Date.now();
    await db.createUser({
      id: userId,
      username,
      displayName: displayName || username,
      passwordHash,
      role: role === 'admin' ? 'admin' : 'family'
    });

    res.json({ success: true, userId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update / Rename User (Admin only)
app.put('/api/users/:userId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Action réservée à l\'administrateur.' });
    }

    const { userId } = req.params;
    const { username, displayName, password, role } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'L\'identifiant est requis.' });
    }

    const existingUser = await db.getUserById(userId);
    if (!existingUser) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }

    // Check username collision with others
    const sameUsername = await db.getUserByUsername(username);
    if (sameUsername && sameUsername.id !== userId) {
      return res.status(400).json({ error: 'Cet identifiant est déjà utilisé par un autre membre.' });
    }

    let passwordHash = null;
    if (password && password.trim().length >= 6) {
      passwordHash = await bcrypt.hash(password.trim(), 10);
    }

    await db.updateUser(userId, {
      username,
      displayName: displayName || username,
      passwordHash,
      role: role || existingUser.role
    });

    res.json({ success: true, message: 'Utilisateur mis à jour avec succès.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete User (Admin only)
app.delete('/api/users/:userId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Action réservée à l\'administrateur.' });
    }

    const { userId } = req.params;

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte Administrateur.' });
    }

    await db.deleteUser(userId);
    res.json({ success: true, message: 'Utilisateur et historique supprimés.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. VAPID Public Key
app.get(['/vapid-public-key', '/api/vapid-public-key'], (req, res) => {
  res.json({ publicKey: pushService.getPublicKey() });
});

// 8. Register Push Subscription
app.post('/api/subscribe', async (req, res) => {
  try {
    const { subscription, userId } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Données de souscription invalides.' });
    }

    const subUserId = userId || (req.user && req.user.id) || 'guest';

    await db.saveSubscription({
      userId: subUserId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Contacts List for 1-to-1 DMs (Admin sees all, members see admin only)
app.get('/api/contacts', authenticateToken, async (req, res) => {
  try {
    const contacts = await db.getContactsForUser(req.user.id, req.user.role);
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Message History (Direct 1-to-1 or Channel)
app.get('/api/history/direct/:targetUserId', authenticateToken, async (req, res) => {
  try {
    const { targetUserId } = req.params;
    await db.markMessagesAsRead(req.user.id, targetUserId);
    io.to(`user_${targetUserId}`).emit('messages_read_by_recipient', { readerId: req.user.id });
    const messages = await db.getDirectMessages(req.user.id, targetUserId, req.user.role, 300);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10b. Delete / Recall Message REST Endpoint
app.delete('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const msg = await db.getMessageById(messageId);
    if (!msg) {
      return res.status(404).json({ error: 'Message introuvable.' });
    }

    const isSender = msg.sender_id === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isSender && !isAdmin) {
      return res.status(403).json({ error: 'Action non autorisée.' });
    }

    const receiver = msg.receiver_id ? await db.getUserById(msg.receiver_id) : null;
    const isReceiverAdmin = receiver && receiver.role === 'admin';

    if (isAdmin) {
      await db.softDeleteMessage(messageId, 'all', req.user.id);
      io.to(`user_${msg.sender_id}`).emit('message_deleted', { messageId, scope: 'all' });
      if (msg.receiver_id) {
        io.to(`user_${msg.receiver_id}`).emit('message_deleted', { messageId, scope: 'all' });
      }
      return res.json({ success: true, message: 'Message supprimé partout.' });
    } else if (isReceiverAdmin) {
      await db.softDeleteMessage(messageId, 'sender_only', req.user.id);
      io.to(`user_${msg.sender_id}`).emit('message_deleted', { messageId, scope: 'sender_only' });
      io.to(`user_${msg.receiver_id}`).emit('message_audit_update', {
        messageId,
        status: 'deleted_by_sender',
        deletedBy: req.user.displayName || req.user.username
      });
      return res.json({ success: true, message: 'Message supprimé de votre fil.' });
    } else {
      await db.softDeleteMessage(messageId, 'all', req.user.id);
      io.to(`user_${msg.sender_id}`).emit('message_deleted', { messageId, scope: 'all' });
      if (msg.receiver_id) {
        io.to(`user_${msg.receiver_id}`).emit('message_deleted', { messageId, scope: 'all' });
      }
      return res.json({ success: true, message: 'Message supprimé.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10c. Edit Message REST Endpoint
app.patch('/api/messages/:messageId', authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const { newContent } = req.body || {};
    if (!newContent || typeof newContent !== 'string' || !newContent.trim()) {
      return res.status(400).json({ error: 'Nouveau contenu requis.' });
    }

    const updatedMsg = await db.editMessage(messageId, req.user.id, newContent.trim());
    const payload = {
      messageId: updatedMsg.id,
      id: updatedMsg.id,
      newContent: updatedMsg.content,
      content: updatedMsg.content,
      sender_id: updatedMsg.sender_id,
      receiver_id: updatedMsg.receiver_id,
      isEdited: 1,
      is_edited: 1,
      editedAt: updatedMsg.edited_at,
      edited_at: updatedMsg.edited_at,
      timestamp: updatedMsg.timestamp
    };

    io.to(`user_${updatedMsg.sender_id}`).emit('message_edited', payload);
    if (updatedMsg.receiver_id) {
      io.to(`user_${updatedMsg.receiver_id}`).emit('message_edited', payload);
    }

    return res.json({ success: true, message: updatedMsg });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

app.get('/api/history/support', async (req, res) => {
  try {
    const { senderId } = req.query;
    if (!senderId || senderId === 'undefined' || senderId === 'null' || String(senderId).trim() === '') {
      return res.json({ messages: [] });
    }
    const messages = await db.getMessages({
      channelType: 'support',
      limit: 200,
      senderId
    });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/history/:channel', authenticateToken, async (req, res) => {
  try {
    const { channel } = req.params;
    const { senderId } = req.query;
    const messages = await db.getMessages({
      channelType: channel,
      limit: 100,
      senderId
    });
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Support Conversations Summary (Admin only)
app.get('/api/support/conversations', authenticateToken, async (req, res) => {
  try {
    const conversations = await db.getSupportConversations();
    res.json({ conversations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Test Push Notification
app.post('/api/test-notification', authenticateToken, async (req, res) => {
  try {
    const result = await pushService.sendNotificationToUser(req.user.id, {
      title: 'DigiCom - Test de notification',
      body: 'Félicitations ! Vos notifications DigiCom fonctionnent parfaitement.',
      icon: '/img/icon-192.png',
      data: { url: '/' }
    });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. File & Media Upload Endpoint
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueName = Date.now() + '_' + (safeBase.substring(0, 20) || 'file') + ext;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 150 * 1024 * 1024 } // 150MB
});

app.post('/api/upload', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier fourni' });
    }
    const fileUrl = '/uploads/' + req.file.filename;
    syncFileToRemoteStorage(req.file.path);
    res.json({
      success: true,
      url: fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype
    });
  });
});

// ---------------- SOCKET.IO REALTIME ENGINE ----------------

const onlineUsers = new Map(); // userId -> Set of socketIds

io.on('connection', (socket) => {
  let currentUser = null;

  const queryUserId = socket.handshake.query && socket.handshake.query.userId;
  if (queryUserId) {
    socket.join(`support_${queryUserId}`);
    socket.join(`user_${queryUserId}`);
  }

  socket.on('join_support', (data) => {
    if (data && data.senderId) {
      socket.join(`support_${data.senderId}`);
    }
  });

  socket.on('authenticate', (userData) => {
    if (!userData || !userData.id) return;
    currentUser = userData;
    socket.userId = userData.id;

    if (!onlineUsers.has(userData.id)) {
      onlineUsers.set(userData.id, new Set());
    }
    onlineUsers.get(userData.id).add(socket.id);

    socket.join(`user_${userData.id}`);
    socket.join(`support_${userData.id}`);
    if (userData.role === 'admin') {
      socket.join('admin_room');
    }

    // Auto-join user's Salon rooms
    db.getSalonsForUser(userData.id).then(salons => {
      if (Array.isArray(salons)) {
        salons.forEach(s => socket.join(`salon_${s.id}`));
      }
    }).catch(err => console.error('[-] Error auto-joining salon rooms:', err));

    io.emit('presence_update', {
      userId: userData.id,
      status: 'online',
      onlineUserIds: Array.from(onlineUsers.keys())
    });

    console.log(`[+] User connected: ${userData.username || userData.id} (${socket.id})`);
  });

  // Direct 1-to-1 Private Message (Hermetic & Private between Sender and Receiver)
  socket.on('private_message', async (data) => {
    try {
      const msgId = data.id || 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const senderId = currentUser ? currentUser.id : data.senderId;
      const senderName = currentUser ? (currentUser.displayName || currentUser.username) : data.senderName;
      const receiverId = data.receiverId;

      if (!receiverId) {
        console.warn('[-] Missing receiverId in private_message');
        return;
      }

      let contentToSave = data.content;
      if (data.replyTo) {
        if (typeof contentToSave === 'string') {
          try {
            const parsed = JSON.parse(contentToSave);
            parsed.replyTo = data.replyTo;
            contentToSave = parsed;
          } catch (e) {
            contentToSave = { type: 'text', text: contentToSave, replyTo: data.replyTo };
          }
        } else if (typeof contentToSave === 'object' && contentToSave !== null) {
          contentToSave.replyTo = data.replyTo;
        }
      }

      // Check if recipient currently has sender's chat window active
      const activeRoomName = `active_chat_${receiverId}_${senderId}`;
      const activeRoom = io.sockets.adapter.rooms.get(activeRoomName);
      const isRecipientActiveInChat = Boolean(activeRoom && activeRoom.size > 0);

      const messageRecord = {
        id: msgId || data.id || uuidv4(),
        channelType: 'private',
        senderId: senderId,
        senderName: senderName || 'Membre',
        receiverId: receiverId,
        content: typeof contentToSave === 'object' ? JSON.stringify(contentToSave) : contentToSave,
        contextData: null,
        is_read: isRecipientActiveInChat ? 1 : 0,
        timestamp: new Date().toISOString()
      };

      await db.saveMessage(messageRecord);

      if (isRecipientActiveInChat) {
        await db.markMessagesAsRead(receiverId, senderId);
        io.to(`user_${senderId}`).emit('messages_read_by_recipient', { readerId: receiverId });
      }

      // Deliver ONLY to the target recipient room and echo back to sender's devices
      io.to(`user_${receiverId}`).emit('private_message', messageRecord);
      io.to(`user_${senderId}`).emit('private_message', messageRecord);

      // If recipient is NOT actively in the visible chat window, send Web Push notification
      if (!isRecipientActiveInChat) {
        let pushBody = 'Nouveau message';
        if (typeof data.content === 'string') {
          pushBody = data.content;
        } else if (data.content && data.content.text) {
          pushBody = data.content.text;
        } else if (data.content && data.content.type === 'audio') {
          pushBody = 'Note vocale';
        } else if (data.content && data.content.type === 'image') {
          pushBody = 'Photo';
        } else if (data.content && data.content.type === 'video') {
          pushBody = 'Vidéo';
        } else if (data.content && data.content.type === 'file') {
          pushBody = `Fichier: ${data.content.fileName || 'Document'}`;
        }

        pushService.sendNotificationToUser(receiverId, {
          title: senderName,
          body: pushBody,
          icon: '/img/icon-192.png',
          data: { url: `/?contact=${senderId}`, channel: 'direct', senderId: senderId }
        });
      }
    } catch (err) {
      console.error('[-] Error handling private_message:', err);
    }
  });

  socket.on('enter_active_chat', (data) => {
    const { partnerId } = data || {};
    const currentUserId = socket.userId || (socket.user ? socket.user.id : null) || (currentUser ? currentUser.id : null);
    if (currentUserId && partnerId) {
      if (socket.activeChatPartner && socket.activeChatPartner !== partnerId) {
        socket.leave(`active_chat_${currentUserId}_${socket.activeChatPartner}`);
      }
      socket.activeChatPartner = partnerId;
      socket.join(`active_chat_${currentUserId}_${partnerId}`);
      console.log(`[+] Socket ${socket.id} (user ${currentUserId}) entered active chat with ${partnerId}`);
    }
  });

  socket.on('leave_active_chat', (data) => {
    const { partnerId } = data || {};
    const currentUserId = socket.userId || (socket.user ? socket.user.id : null) || (currentUser ? currentUser.id : null);
    const targetPartner = partnerId || socket.activeChatPartner;
    if (currentUserId) {
      if (targetPartner) {
        socket.leave(`active_chat_${currentUserId}_${targetPartner}`);
      }
      if (socket.activeChatPartner) {
        socket.leave(`active_chat_${currentUserId}_${socket.activeChatPartner}`);
      }
      socket.activeChatPartner = null;
      console.log(`[+] Socket ${socket.id} (user ${currentUserId}) left active chat with ${targetPartner}`);
    }
  });

  socket.on('mark_read', async (data) => {
    try {
      const { senderId } = data;
      const currentUserId = socket.userId || (socket.user ? socket.user.id : null) || (currentUser ? currentUser.id : null);
      if (senderId && currentUserId) {
        await db.markMessagesAsRead(currentUserId, senderId);
        io.to(`user_${senderId}`).emit('messages_read_by_recipient', { readerId: currentUserId });
      }
    } catch (err) {
      console.error('[-] Error handling mark_read:', err);
    }
  });

  // Join & Leave Salon Room Handlers
  socket.on('join_salon', (salonId) => {
    if (salonId) {
      socket.join(`salon_${salonId}`);
    }
  });

  socket.on('leave_salon', (salonId) => {
    if (salonId) {
      socket.leave(`salon_${salonId}`);
    }
  });

  // Salon Real-Time Message Handler
  socket.on('salon_message', async (data) => {
    try {
      const salonId = data.salonId;
      if (!salonId) return;

      const msgId = data.id || 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const senderId = currentUser ? currentUser.id : data.senderId;
      const senderName = currentUser ? (currentUser.displayName || currentUser.username) : data.senderName;

      // Check if user is blocked in this salon
      const isBlocked = await db.isSalonMemberBlocked(salonId, senderId);
      if (isBlocked) {
        socket.emit('salon_error', {
          salonId,
          message: 'Vous avez été bloqué dans ce Salon et ne pouvez plus envoyer de messages.'
        });
        return;
      }

      let contentToSave = data.content;
      if (data.replyTo) {
        if (typeof contentToSave === 'string') {
          try {
            const parsed = JSON.parse(contentToSave);
            parsed.replyTo = data.replyTo;
            contentToSave = parsed;
          } catch (e) {
            contentToSave = { type: 'text', text: contentToSave, replyTo: data.replyTo };
          }
        } else if (typeof contentToSave === 'object' && contentToSave !== null) {
          contentToSave.replyTo = data.replyTo;
        }
      }

      const messageRecord = {
        id: msgId,
        channelType: 'salon',
        senderId: senderId,
        senderName: senderName || 'Membre',
        receiverId: salonId,
        content: typeof contentToSave === 'object' ? JSON.stringify(contentToSave) : contentToSave,
        contextData: data.contextData || null,
        timestamp: new Date().toISOString()
      };

      await db.saveMessage(messageRecord);

      // Broadcast message to all members currently in the salon room
      io.to(`salon_${salonId}`).emit('new_salon_message', messageRecord);

      // Deliver directly to each salon member room & send push if not actively viewing
      const salonMembers = await db.getSalonMembers(salonId);
      const salonData = await db.getSalonById(salonId);
      const rawSalonName = salonData ? salonData.name : 'Salon';
      const formattedSalonName = '#' + rawSalonName.replace(/^#+/, '');

      let pushBody = 'Nouveau message dans le salon';
      try {
        const parsed = typeof messageRecord.content === 'string' ? JSON.parse(messageRecord.content) : messageRecord.content;
        if (parsed.type === 'text') pushBody = parsed.text;
        else if (parsed.type === 'audio') pushBody = 'Note vocale';
        else if (parsed.type === 'image') pushBody = 'Photo';
        else if (parsed.type === 'video') pushBody = 'Vidéo';
        else if (parsed.type === 'file') pushBody = `Fichier: ${parsed.fileName || 'Document'}`;
      } catch (e) {
        if (typeof messageRecord.content === 'string') pushBody = messageRecord.content;
      }

      // Extract mentioned usernames if any
      let textToCheck = '';
      try {
        const parsed = typeof messageRecord.content === 'string' ? JSON.parse(messageRecord.content) : messageRecord.content;
        if (parsed.type === 'text') textToCheck = parsed.text || '';
      } catch (e) {
        if (typeof messageRecord.content === 'string') textToCheck = messageRecord.content;
      }
      const mentionMatches = [...textToCheck.matchAll(/@([a-zA-Z0-9_\-]+)/g)].map(m => m[1].toLowerCase());
      const mentionedUsernames = new Set(mentionMatches);

      for (const member of salonMembers) {
        if (member.id !== senderId) {
          // Check if recipient is actively inside this specific salon chat
          const activeSalonRoom = io.sockets.adapter.rooms.get(`active_chat_${member.id}_${salonId}`);
          const isMemberActiveInSalon = Boolean(activeSalonRoom && activeSalonRoom.size > 0);

          // Send Push ONLY if member is not actively viewing this salon chat
          if (!isMemberActiveInSalon) {
            const isMentioned = member.username && (mentionedUsernames.has(member.username.toLowerCase()) || (member.display_name && mentionedUsernames.has(member.display_name.toLowerCase())));
            const notificationTitle = isMentioned
              ? `${formattedSalonName} • ${senderName} vous a mentionné`
              : `${formattedSalonName} • ${senderName}`;

            pushService.sendNotificationToUser(member.id, {
              title: notificationTitle,
              body: pushBody.length > 70 ? pushBody.substring(0, 70) + '...' : pushBody,
              icon: '/img/icon-192.png',
              badge: '/img/badge-72.png',
              data: {
                url: `/?salon=${salonId}`,
                channel: 'salon',
                salonId: salonId
              }
            }).catch(e => console.error('[-] Push error to salon member:', e));
          }
        }
      }

    } catch (err) {
      console.error('[-] Error handling salon_message:', err);
    }
  });

  // Support Message (RebOnly SOS Widget)
  socket.on('trainer_message', async (data) => {
    try {
      const msgId = data.id || 'sos_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const senderId = data.senderId || 'guest_' + socket.id;
      const senderName = data.senderName || 'Formateur / Visiteur';
      const context = data.contextData || {};

      const activeRoomName = `active_chat_admin_${senderId}`;
      const activeRoom = io.sockets.adapter.rooms.get(activeRoomName);
      const isRecipientActiveInChat = Boolean(activeRoom && activeRoom.size > 0);

      const messageRecord = {
        id: msgId,
        channelType: 'support',
        senderId: senderId,
        senderName: senderName,
        receiverId: 'admin',
        content: data.content,
        contextData: context,
        is_read: isRecipientActiveInChat ? 1 : 0,
        timestamp: new Date().toISOString()
      };

      await db.saveMessage(messageRecord);

      if (isRecipientActiveInChat) {
        await db.markMessagesAsRead('admin', senderId);
        io.to(`user_${senderId}`).emit('messages_read_by_recipient', { readerId: 'admin' });
      }

      // Join the session room for direct replies
      socket.join(`support_${senderId}`);

      // Emit to Admin room
      io.to('admin_room').emit('support_message', messageRecord);

      // Echo back to sender for acknowledgment
      socket.emit('support_message', messageRecord);

      // Trigger high-priority Web Push to Admin device
      const courseTitle = context.courseTitle || context.pageTitle || '';
      pushService.sendNotificationToAdmin({
        title: `SOS Support - ${senderName}`,
        body: courseTitle ? `[${courseTitle}] : ${data.content}` : data.content,
        icon: '/img/icon-192.png',
        data: {
          url: `/?channel=support&sender=${senderId}`,
          channel: 'support',
          senderId: senderId
        }
      });

      console.log(`[!] SOS Received from ${senderName} (${senderId})`);
    } catch (err) {
      console.error('[-] Error handling trainer_message:', err);
    }
  });

  // Admin Reply to SOS / Support Ticket
  socket.on('admin_reply', async (data) => {
    try {
      const msgId = data.id || 'rep_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const targetUserId = data.targetUserId;
      const currentAdminId = currentUser ? currentUser.id : 'admin';

      const activeRoomName = `active_chat_${targetUserId}_${currentAdminId}`;
      const activeRoom = io.sockets.adapter.rooms.get(activeRoomName);
      const isRecipientActiveInChat = Boolean(activeRoom && activeRoom.size > 0);

      const messageRecord = {
        id: msgId,
        channelType: 'support',
        senderId: currentAdminId,
        senderName: currentUser ? (currentUser.displayName || 'Support DigiCom') : 'Support DigiCom',
        receiverId: targetUserId,
        content: data.content,
        contextData: null,
        is_read: isRecipientActiveInChat ? 1 : 0,
        timestamp: new Date().toISOString()
      };

      await db.saveMessage(messageRecord);

      if (isRecipientActiveInChat) {
        await db.markMessagesAsRead(targetUserId, currentAdminId);
        io.to(`user_${currentAdminId}`).emit('messages_read_by_recipient', { readerId: targetUserId });
      }

      // Deliver to specific support session and admin rooms
      io.to(`support_${targetUserId}`).emit('support_message', messageRecord);
      io.to('admin_room').emit('support_message', messageRecord);
    } catch (err) {
      console.error('[-] Error handling admin_reply:', err);
    }
  });

  socket.on('support_mark_read', async (data) => {
    try {
      const { senderId } = data;
      if (senderId) {
        await db.markSupportMessagesAsRead(senderId);
        io.to(`support_${senderId}`).emit('support_read_receipt', { senderId });
        io.to('admin_room').emit('support_read_receipt', { senderId });
      }
    } catch (err) {
      console.error('[-] Error handling support_mark_read:', err);
    }
  });

  // Typing indicator
  socket.on('typing', (data) => {
    if (data && data.receiverId) {
      io.to(`user_${data.receiverId}`).emit('typing', {
        senderId: currentUser ? currentUser.id : socket.userId,
        senderName: currentUser ? (currentUser.displayName || currentUser.username) : 'Membre'
      });
    } else if (data && data.salonId) {
      socket.to(`salon_${data.salonId}`).emit('salon_typing', {
        salonId: data.salonId,
        userId: currentUser ? currentUser.id : socket.userId,
        userName: currentUser ? (currentUser.displayName || currentUser.username) : 'Un membre',
        isTyping: data.isTyping !== false
      });
    } else if (data.channel === 'support') {
      if (data.targetRoom) {
        socket.to(data.targetRoom).emit('typing', { senderName: data.senderName, channel: 'support' });
      } else {
        socket.to('admin_room').emit('typing', { senderName: data.senderName, senderId: data.senderId, channel: 'support' });
      }
    }
  });

  socket.on('salon_typing', (data) => {
    if (data && data.salonId) {
      socket.to(`salon_${data.salonId}`).emit('salon_typing', {
        salonId: data.salonId,
        userId: currentUser ? currentUser.id : socket.userId,
        userName: currentUser ? (currentUser.displayName || currentUser.username) : 'Un membre',
        isTyping: data.isTyping !== false
      });
    }
  });

  // Delete / Recall Message via Realtime Socket
  socket.on('delete_message', async (data) => {
    try {
      const messageId = data && data.messageId;
      if (!messageId) return;

      const msg = await db.getMessageById(messageId);
      if (!msg) return;

      const userId = currentUser ? currentUser.id : socket.userId;
      const userRole = currentUser ? currentUser.role : 'family';
      const isSender = msg.sender_id === userId;
      const isAdmin = userRole === 'admin';

      if (!isSender && !isAdmin) return;

      if (msg.channel_type === 'salon') {
        await db.softDeleteMessage(messageId, 'all', userId);
        io.to(`salon_${msg.receiver_id}`).emit('message_deleted', { messageId, scope: 'all' });
        return;
      }

      const receiver = msg.receiver_id ? await db.getUserById(msg.receiver_id) : null;
      const isReceiverAdmin = receiver && receiver.role === 'admin';

      if (isAdmin) {
        await db.softDeleteMessage(messageId, 'all', userId);
        io.to(`user_${msg.sender_id}`).emit('message_deleted', { messageId, scope: 'all' });
        if (msg.receiver_id) {
          io.to(`user_${msg.receiver_id}`).emit('message_deleted', { messageId, scope: 'all' });
        }
      } else if (isReceiverAdmin) {
        await db.softDeleteMessage(messageId, 'sender_only', userId);
        io.to(`user_${msg.sender_id}`).emit('message_deleted', { messageId, scope: 'sender_only' });
        io.to(`user_${msg.receiver_id}`).emit('message_audit_update', {
          messageId,
          status: 'deleted_by_sender',
          deletedBy: currentUser ? (currentUser.displayName || currentUser.username) : 'Membre'
        });
      } else {
        await db.softDeleteMessage(messageId, 'all', userId);
        io.to(`user_${msg.sender_id}`).emit('message_deleted', { messageId, scope: 'all' });
        if (msg.receiver_id) {
          io.to(`user_${msg.receiver_id}`).emit('message_deleted', { messageId, scope: 'all' });
        }
      }
    } catch (e) {
      console.error('[-] Error handling delete_message socket event:', e);
    }
  });

  // Edit Message via Realtime Socket
  socket.on('edit_message', async (data) => {
    try {
      const { messageId, newContent } = data || {};
      if (!messageId || !newContent || typeof newContent !== 'string' || !newContent.trim()) return;

      const userId = currentUser ? currentUser.id : socket.userId;
      if (!userId) return;

      const updatedMsg = await db.editMessage(messageId, userId, newContent.trim());
      
      const payload = {
        messageId: updatedMsg.id,
        id: updatedMsg.id,
        newContent: updatedMsg.content,
        content: updatedMsg.content,
        sender_id: updatedMsg.sender_id,
        receiver_id: updatedMsg.receiver_id,
        isEdited: 1,
        is_edited: 1,
        editedAt: updatedMsg.edited_at,
        edited_at: updatedMsg.edited_at,
        timestamp: updatedMsg.timestamp
      };

      // Broadcast updated message to sender and receiver or salon room
      if (updatedMsg.channel_type === 'salon') {
        io.to(`salon_${updatedMsg.receiver_id}`).emit('message_edited', payload);
      } else {
        io.to(`user_${updatedMsg.sender_id}`).emit('message_edited', payload);
        if (updatedMsg.receiver_id) {
          io.to(`user_${updatedMsg.receiver_id}`).emit('message_edited', payload);
        }
      }
    } catch (e) {
      console.error('[-] Error handling edit_message socket event:', e);
    }
  });

  // ---------------- WebRTC Audio & Video Calling Signaling ----------------
  socket.on('call_user', (data) => {
    const callerId = socket.user ? socket.user.id : socket.userId;
    const callerName = socket.user ? (socket.user.displayName || socket.user.username) : 'Membre';
    if (data && data.targetUserId) {
      io.to(`user_${data.targetUserId}`).emit('call_incoming', {
        callerId,
        callerName,
        callType: data.callType || 'audio',
        offer: data.offer
      });
    }
  });

  socket.on('call_accepted', (data) => {
    if (data && data.targetUserId) {
      io.to(`user_${data.targetUserId}`).emit('call_accepted', {
        answer: data.answer
      });
    }
  });

  socket.on('call_rejected', (data) => {
    if (data && data.targetUserId) {
      io.to(`user_${data.targetUserId}`).emit('call_rejected', {
        reason: data.reason || 'Appel refusé'
      });
    }
  });

  socket.on('ice_candidate', (data) => {
    if (data && data.targetUserId && data.candidate) {
      io.to(`user_${data.targetUserId}`).emit('ice_candidate', {
        candidate: data.candidate
      });
    }
  });

  socket.on('call_ended', (data) => {
    if (data && data.targetUserId) {
      io.to(`user_${data.targetUserId}`).emit('call_ended');
    }
  });

  socket.on('disconnect', () => {
    if (currentUser && onlineUsers.has(currentUser.id)) {
      const userSockets = onlineUsers.get(currentUser.id);
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(currentUser.id);
        io.emit('presence_update', {
          userId: currentUser.id,
          status: 'offline',
          onlineUserIds: Array.from(onlineUsers.keys())
        });
      }
    }
    console.log(`[-] Socket disconnected: ${socket.id}`);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` 🚀 DigiCom Server is running on port ${PORT}`);
  console.log(` 🔒 E2EE & VAPID Sovereign Realtime Engine Ready`);
  console.log(`====================================================`);
});
