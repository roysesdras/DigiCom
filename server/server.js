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
const { randomUUID } = require('crypto');
const uuidv4 = () => randomUUID();

const { exec } = require('child_process');
const cron = require('node-cron');
const db = require('./database');
const pushService = require('./push-service');
const logger = require('./logger');
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
  const remoteTarget = `${STORAGE_USER}@${STORAGE_HOST}:${STORAGE_REMOTE_PATH}/`;
  const cmd = `ionice -c3 nice -n 19 rsync -az -e "ssh ${sshOption}" "${filePath}" "${remoteTarget}"`;
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      logger.warn('STORAGE', `Remote storage sync warning for ${path.basename(filePath)}: ${err.message}`);
    } else {
      logger.info('STORAGE', `File synced to remote storage: ${path.basename(filePath)}`);
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

function pruneLocalUploadsCache(maxAgeDays = 7) {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  fs.readdir(uploadsDir, (err, files) => {
    if (err) {
      console.error('[-] Error reading uploads directory for cache pruning:', err.message);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        if (stats.isFile()) {
          const fileAge = now - stats.mtimeMs;
          if (fileAge > maxAgeMs) {
            fs.unlink(filePath, (unlinkErr) => {
              if (!unlinkErr) {
                console.log(`[+] Pruned 7-day old local upload cache: ${file}`);
              }
            });
          }
        }
      });
    });
  });
}

// Schedule daily automated encrypted database backup at 03:30 AM every night (node-cron Option 1)
cron.schedule('30 3 * * *', () => {
  console.log('[*] Triggering scheduled nightly database backup at 03:30 AM...');
  performBackup().catch(err => console.error('[-] Scheduled backup error:', err));
});

// Schedule nightly 7-day local upload cache pruning at 04:00 AM every night
cron.schedule('0 4 * * *', () => {
  console.log('[*] Triggering scheduled nightly 7-day local upload cache pruning at 04:00 AM...');
  pruneLocalUploadsCache(7);
});

// Socket.io with permissive CORS for standalone widget integration & strict heartbeat
const io = new Server(server, {
  pingInterval: 25000,
  pingTimeout: 20000,
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
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src-elem * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src-attr * 'unsafe-inline' 'unsafe-eval' data: blob:; style-src * 'unsafe-inline' data: blob:; img-src * data: blob:; media-src * data: blob:; connect-src * 'unsafe-inline' blob:; frame-src *;"
  );
  next();
});

app.use(express.json());
app.use(cookieParser());

function setStaticCacheHeaders(res, filePath) {
  // 1. Dynamic Entry Points (Always fresh)
  if (filePath.endsWith('.html') || filePath.includes('sw.js')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  // 2. Immutable Fonts
  else if (filePath.match(/\.(woff2?|ttf|eot|otf)$/i)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  // 3. Modern Next-Gen Images & Media
  else if (filePath.match(/\.(webp|png|jpe?g|svg|ico|gif)$/i)) {
    res.setHeader('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=86400');
  }
  // 4. Versioned CSS & JS Assets
  else if (filePath.match(/\.(css|js)$/i)) {
    res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
  }
  // 5. Web App Manifest
  else if (filePath.endsWith('manifest.json')) {
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}

// Ultra-Fast Pre-Compressed Brotli (.br) & Gzip (.gz) Asset Handler
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const reqPath = req.path === '/' ? '/index.html' : req.path;
  const filePath = path.join(__dirname, '..', 'public', reqPath);

  if (acceptEncoding.includes('br') && fs.existsSync(filePath + '.br')) {
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    else if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=UTF-8');
    else if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    else if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Content-Encoding', 'br');
    res.setHeader('Vary', 'Accept-Encoding');
    setStaticCacheHeaders(res, filePath);
    return res.sendFile(filePath + '.br');
  } else if (acceptEncoding.includes('gzip') && fs.existsSync(filePath + '.gz')) {
    if (filePath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript; charset=UTF-8');
    else if (filePath.endsWith('.css')) res.setHeader('Content-Type', 'text/css; charset=UTF-8');
    else if (filePath.endsWith('.html')) res.setHeader('Content-Type', 'text/html; charset=UTF-8');
    else if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    setStaticCacheHeaders(res, filePath);
    return res.sendFile(filePath + '.gz');
  }
  next();
});

// Static Files with High-Performance Caching Policy (Audited for Lighthouse & GTmetrix)
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  setHeaders: setStaticCacheHeaders
}));
app.use('/widget', express.static(path.join(__dirname, '..', 'widget'), {
  etag: true,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));
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
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

// System Log Viewer & Exporter Endpoint
app.get('/api/logs', (req, res) => {
  const download = req.query.download === '1' || req.query.download === 'true';
  if (download) {
    const logPath = logger.getLogFilePath();
    if (fs.existsSync(logPath)) {
      return res.download(logPath, `digicom_${new Date().toISOString().slice(0, 10)}.log`);
    }
    return res.status(404).send('Log file not found');
  }
  const lines = parseInt(req.query.lines) || 200;
  const logs = logger.readLogFile(lines);
  if (req.query.json === '1') {
    return res.json({ success: true, count: logs.length, logs });
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(logs.join('\n'));
});

// Client & Service Worker Log Collector Endpoint
app.post('/api/client-log', (req, res) => {
  const { level = 'info', tag = 'CLIENT', message = '', data = null } = req.body || {};
  if (level === 'error') {
    logger.error(tag, message, data);
  } else if (level === 'warn') {
    logger.warn(tag, message, data);
  } else {
    logger.info(tag, message, data);
  }
  res.json({ success: true });
});

// 1b. Link Preview (Open Graph metadata scraper with Server-side Caching)
const linkPreviewServerCache = new Map();
const LINK_PREVIEW_CACHE_TTL = 3600 * 2000; // 2 hours

app.get('/api/link-preview', authenticateToken, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  // Basic URL validation
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).json({ error: 'Invalid protocol' });
    }
    // Block private/internal IPs (SSRF protection)
    const hostname = parsedUrl.hostname.toLowerCase();
    const blocked = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (blocked.includes(hostname) || /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
      return res.status(403).json({ error: 'Forbidden URL' });
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const normalizedUrl = parsedUrl.toString();
  const cached = linkPreviewServerCache.get(normalizedUrl);
  if (cached && (Date.now() - cached.timestamp < LINK_PREVIEW_CACHE_TTL)) {
    return res.json(cached.data);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const isSocial = /facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|twitter\.com|x\.com|threads\.net/i.test(parsedUrl.hostname);
    const userAgent = isSocial
      ? 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php) Facebot Twitterbot/1.0 WhatsApp/2.23.20'
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

    const fetchRes = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      redirect: 'follow'
    });
    clearTimeout(timeout);

    const contentType = fetchRes.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      const fallback = { url: normalizedUrl, title: parsedUrl.hostname, description: null, image: null, domain: parsedUrl.hostname };
      linkPreviewServerCache.set(normalizedUrl, { data: fallback, timestamp: Date.now() });
      return res.json(fallback);
    }

    const html = await fetchRes.text();

    const decodeEntities = (str) => {
      if (!str) return null;
      return str
        .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
        .replace(/&#x([0-9a-f]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#039;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&eacute;/g, 'é')
        .replace(/&egrave;/g, 'è')
        .replace(/&agrave;/g, 'à')
        .replace(/&ecirc;/g, 'ê')
        .replace(/&ocirc;/g, 'ô')
        .replace(/&ccedil;/g, 'ç')
        .trim();
    };

    // Parse Open Graph & Twitter & meta tags
    const getMeta = (property) => {
      const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, 'i'));
      return match ? decodeEntities(match[1]) : null;
    };

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const rawTitle = getMeta('og:title') || getMeta('twitter:title') || (titleMatch ? titleMatch[1] : parsedUrl.hostname);
    const title = decodeEntities(rawTitle);
    const description = getMeta('og:description') || getMeta('twitter:description') || getMeta('description');
    let image = getMeta('og:image') || getMeta('twitter:image') || getMeta('image');

    // Convert relative image URL to absolute
    if (image && !image.startsWith('http')) {
      try {
        image = new URL(image, parsedUrl.origin).toString();
      } catch (e) {
        image = null;
      }
    }

    const result = {
      url: normalizedUrl,
      title: title || parsedUrl.hostname,
      description: description ? description.substring(0, 200) : null,
      image: image || null,
      domain: parsedUrl.hostname.replace(/^www\./, '')
    };

    linkPreviewServerCache.set(normalizedUrl, { data: result, timestamp: Date.now() });
    if (linkPreviewServerCache.size > 500) {
      const firstKey = linkPreviewServerCache.keys().next().value;
      linkPreviewServerCache.delete(firstKey);
    }

    return res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(408).json({ error: 'Timeout fetching URL' });
    }
    const fallback = { url: normalizedUrl, title: parsedUrl.hostname, description: null, image: null, domain: parsedUrl.hostname };
    return res.json(fallback);
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

// 3c. Contact Management Endpoints
app.get('/api/contacts/search', authenticateToken, async (req, res) => {
  try {
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

app.post('/api/contacts/find-exact', authenticateToken, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Nom d\'utilisateur requis' });
    }
    const cleanUsername = username.trim().replace(/^@/, '');
    const user = await db.getUserByExactUsername(cleanUsername);
    if (!user) {
      return res.status(404).json({ error: 'Aucun utilisateur trouvé avec ce @pseudo exact' });
    }
    if (user.id === req.user.id) {
      return res.status(400).json({ error: 'Il s\'agit de votre propre compte' });
    }
    const isContact = await db.areUsersContacts(req.user.id, user.id);
    const existingReq = await db.getPendingContactRequests(user.id);
    const hasPendingSent = existingReq.some(r => r.sender_id === req.user.id);
    const myIncoming = await db.getPendingContactRequests(req.user.id);
    const incomingReq = myIncoming.find(r => r.sender_id === user.id);

    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role
      },
      isContact,
      hasPendingSent,
      incomingRequestId: incomingReq ? incomingReq.request_id : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contacts/request', authenticateToken, async (req, res) => {
  try {
    const { username, targetUserId } = req.body;
    let targetUser = null;
    if (targetUserId) {
      targetUser = await db.getUserById(targetUserId);
    } else if (username) {
      targetUser = await db.getUserByExactUsername(username);
    }
    if (!targetUser) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    if (targetUser.id === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous ajouter vous-même' });
    }

    const result = await db.createContactRequest(req.user.id, targetUser.id);
    const sender = await db.getUserById(req.user.id);

    if (result.autoAccepted) {
      io.to(`user_${req.user.id}`).emit('contact_added', { contact: targetUser });
      io.to(`user_${targetUser.id}`).emit('contact_added', { contact: sender });
      io.to(`user_${req.user.id}`).emit('contact_request_accepted', { contact: targetUser, requestId: result.requestId });
      io.to(`user_${targetUser.id}`).emit('contact_request_accepted', { contact: sender, requestId: result.requestId });

      return res.json({ success: true, autoAccepted: true, contact: targetUser });
    }

    // Emit Socket notification to receiver
    io.to(`user_${targetUser.id}`).emit('new_contact_request', {
      requestId: result.requestId,
      sender: {
        id: sender.id,
        username: sender.username,
        displayName: sender.display_name,
        role: sender.role
      }
    });

    // Send Web Push notification to receiver
    pushService.sendNotificationToUser(targetUser.id, {
      title: 'Nouvelle demande de contact',
      body: `${sender.display_name || sender.username} (@${sender.username}) souhaite vous ajouter à ses contacts.`,
      icon: '/img/icon-192.png',
      badge: '/img/badge-72.png',
      data: {
        url: '/?openRequests=true',
        openRequests: true,
        type: 'contact_request',
        senderId: sender.id
      }
    }).catch(e => console.error('[-] Push error for contact request:', e));

    res.json({ success: true, autoAccepted: false, requestId: result.requestId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/contacts/requests/pending', authenticateToken, async (req, res) => {
  try {
    const requests = await db.getPendingContactRequests(req.user.id);
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/contacts/requests/:id/accept', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const request = await db.acceptContactRequest(id, req.user.id);
    const sender = await db.getUserById(request.sender_id);
    const receiver = await db.getUserById(request.receiver_id);

    // Notify both users in real-time
    io.to(`user_${request.sender_id}`).emit('contact_added', { contact: receiver });
    io.to(`user_${request.receiver_id}`).emit('contact_added', { contact: sender });
    io.to(`user_${request.sender_id}`).emit('contact_request_accepted', { contact: receiver, requestId: id });
    io.to(`user_${request.receiver_id}`).emit('contact_request_accepted', { contact: sender, requestId: id });

    // Send push notification to sender that request was accepted
    pushService.sendNotificationToUser(request.sender_id, {
      title: 'Demande de contact acceptée',
      body: `Votre demande à @${receiver.username} a été acceptée.`,
      icon: '/img/icon-192.png',
      badge: '/img/badge-72.png',
      data: { url: `/?contact=${receiver.id}` }
    }).catch(e => console.error('[-] Push error for accepted request:', e));

    res.json({ success: true, contact: sender });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/contacts/requests/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const request = await db.getContactRequestById(id);
    if (!request) {
      return res.status(404).json({ error: 'Demande introuvable' });
    }
    await db.rejectContactRequest(id, req.user.id);

    const sender = await db.getUserById(request.sender_id);
    const receiver = await db.getUserById(request.receiver_id);

    // Notify sender in real-time about rejection
    io.to(`user_${request.sender_id}`).emit('contact_request_rejected', {
      receiver: {
        id: receiver ? receiver.id : request.receiver_id,
        username: receiver ? receiver.username : 'contact',
        displayName: receiver ? (receiver.display_name || receiver.username) : 'contact'
      },
      requestId: id
    });

    // Send push notification to sender that request was rejected
    if (receiver) {
      pushService.sendNotificationToUser(request.sender_id, {
        title: 'Demande de contact refusée',
        body: `Votre demande à @${receiver.username} a été refusée.`,
        icon: '/img/icon-192.png',
        badge: '/img/badge-72.png',
        data: { url: '/?tab=contacts' }
      }).catch(e => console.error('[-] Push error for rejected request:', e));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/contacts/invite-info/:username', authenticateToken, async (req, res) => {
  try {
    const { username } = req.params;
    const user = await db.getUserByExactUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }
    const isContact = await db.areUsersContacts(req.user.id, user.id);
    res.json({
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role
      },
      isContact
    });
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
    const { limit, before } = req.query;
    const isMember = await db.getSalonMembers(id);
    if (!isMember.some(m => m.id === req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès non autorisé à ce Salon' });
    }
    await db.markSalonMessagesAsRead(id, req.user.id);
    io.to(`salon_${id}`).emit('salon_messages_read', {
      salonId: id,
      readerId: req.user.id,
      readerName: req.user.displayName || req.user.username
    });
    const messages = await db.getSalonMessages(id, limit || 50, before || null);
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

// Update member role (Promote / Demote Co-Admin - Creator only)
app.put('/api/salons/:id/members/:userId/role', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { role } = req.body; // 'admin' or 'member'

    if (role !== 'admin' && role !== 'member') {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const isCreator = await db.isSalonCreator(id, req.user.id);
    if (!isCreator) {
      return res.status(403).json({ error: 'Seul le créateur du salon peut nommer ou rétrograder des administrateurs.' });
    }

    const salon = await db.getSalonById(id);
    if (!salon) return res.status(404).json({ error: 'Salon introuvable' });
    if (salon.created_by === userId) {
      return res.status(400).json({ error: 'Le rôle du créateur ne peut pas être modifié.' });
    }

    if (role === 'admin') {
      const currentMembers = await db.getSalonMembers(id);
      const currentAdmins = currentMembers.filter(m => m.salon_role === 'admin');
      if (currentAdmins.length >= 3) {
        return res.status(400).json({ error: 'Vous avez déjà atteint la limite de 3 administrateurs délégués.' });
      }
    }

    await db.updateSalonMemberRole(id, userId, role);

    io.to(`salon_${id}`).emit('salon_updated', { salonId: id });
    const members = await db.getSalonMembers(id);
    res.json({ success: true, role, members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a member from the salon (Creator only)
app.delete('/api/salons/:id/members/:userId', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const isCreator = await db.isSalonCreator(id, req.user.id);
    if (!isCreator) {
      return res.status(403).json({ error: 'Seul le créateur du salon peut retirer des membres.' });
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

// Block/Unblock a member in the salon (Creator only)
app.post('/api/salons/:id/members/:userId/block', authenticateToken, async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { blocked } = req.body;
    const isCreator = await db.isSalonCreator(id, req.user.id);
    if (!isCreator) {
      return res.status(403).json({ error: 'Seul le créateur du salon peut bloquer des membres.' });
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
    const isCreator = await db.isSalonCreator(id, req.user.id);
    if (!isCreator) {
      return res.status(403).json({ error: 'Seul le créateur du salon peut supprimer définitivement ce Salon.' });
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

// === Salon 6 Collaborative Modules REST Endpoints ===

// 1. Tâches (Tasks & Kanban)
app.get('/api/salons/:id/tasks', authenticateToken, async (req, res) => {
  try {
    const tasks = await db.getSalonTasks(req.params.id);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/:id/tasks', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, assignedTo, dueDate } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Le titre de la tâche est requis' });
    
    const taskId = 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    await db.createSalonTask({
      id: taskId,
      salonId: id,
      title: title.trim(),
      description: description ? description.trim() : '',
      assignedTo: assignedTo || null,
      dueDate: dueDate || null,
      createdBy: req.user.id
    });

    // Broadcast task update to connected sockets
    const tasks = await db.getSalonTasks(id);
    io.to(`salon_${id}`).emit('salon_task_updated', { salonId: id, tasks });

    // Send an automatic system announcement message in the salon chat feed
    try {
      const assignedUser = assignedTo ? await db.getUserById(assignedTo) : null;
      const assignedName = assignedUser ? (assignedUser.display_name || assignedUser.username) : 'Toute l\'équipe';
      const creatorName = req.user.displayName || req.user.username;
      
      const annMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const annRecord = {
        id: annMsgId,
        channelType: 'salon',
        senderId: req.user.id,
        senderName: 'Système Salon',
        receiverId: id,
        content: JSON.stringify({
          type: 'task_announcement',
          isTaskAnnouncement: true,
          action: 'created',
          taskId: taskId,
          title: title.trim(),
          creatorName: creatorName,
          assignedName: assignedName,
          dueDate: dueDate || null,
          text: `📌 Nouvelle Tâche : ${title.trim()} (Assignée à : ${assignedName})`
        }),
        contextData: null,
        is_read: 0,
        timestamp: new Date().toISOString()
      };
      
      await db.saveMessage(annRecord);
      io.to(`salon_${id}`).emit('salon_message', annRecord);

      // Web Push notification to all members of the salon
      const members = await db.getSalonMembers(id);
      const salonObj = await db.getSalonById(id);
      const salonName = salonObj ? salonObj.name : 'Salon';
      
      members.forEach(m => {
        if (m.id !== req.user.id) {
          const isAssigned = (m.id === assignedTo);
          pushService.sendNotificationToUser(m.id, {
            title: isAssigned ? `🎯 Tâche assignée dans #${salonName}` : `📋 Nouvelle Tâche dans #${salonName}`,
            body: isAssigned ? `${creatorName} vous a assigné la tâche : "${title.trim()}"` : `${creatorName} a créé la tâche : "${title.trim()}" (Assignée à: ${assignedName})`,
            icon: '/img/icon-192.png',
            data: { url: `/?salon=${id}`, channel: 'salon', salonId: id }
          }).catch(e => console.error('[-] Push error for task:', e));
        }
      });
    } catch (e) {
      console.error('[-] Task announcement error:', e);
    }

    res.json({ success: true, taskId, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/salons/:id/tasks/:taskId', authenticateToken, async (req, res) => {
  try {
    const { id, taskId } = req.params;
    const { status } = req.body;
    await db.updateSalonTaskStatus(taskId, status);

    const tasks = await db.getSalonTasks(id);
    io.to(`salon_${id}`).emit('salon_task_updated', { salonId: id, tasks });

    // Status change notification
    const statusLabels = { todo: 'À faire', in_progress: 'En cours', done: 'Terminé' };
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const changerName = req.user.displayName || req.user.username;
      const annMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const annRecord = {
        id: annMsgId,
        channelType: 'salon',
        senderId: req.user.id,
        senderName: 'Système Salon',
        receiverId: id,
        content: JSON.stringify({
          type: 'task_announcement',
          isTaskAnnouncement: true,
          action: 'updated',
          taskId: taskId,
          title: task.title,
          statusLabel: statusLabels[status] || status,
          changerName: changerName,
          text: `📋 Statut de la tâche "${task.title}" changé à ${statusLabels[status] || status} par ${changerName}`
        }),
        contextData: null,
        is_read: 0,
        timestamp: new Date().toISOString()
      };
      await db.saveMessage(annRecord);
      io.to(`salon_${id}`).emit('salon_message', annRecord);

      // Push notification for status change
      const members = await db.getSalonMembers(id);
      const salonObj = await db.getSalonById(id);
      const salonName = salonObj ? salonObj.name : 'Salon';
      members.forEach(m => {
        if (m.id !== req.user.id) {
          pushService.sendNotificationToUser(m.id, {
            title: `📋 Tâche mise à jour dans #${salonName}`,
            body: `${changerName} a passé "${task.title}" à ${statusLabels[status] || status}`,
            icon: '/img/icon-192.png',
            data: { url: `/?salon=${id}`, channel: 'salon', salonId: id }
          }).catch(e => console.error('[-] Push error for task status update:', e));
        }
      });
    }

    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/salons/:id/tasks/:taskId', authenticateToken, async (req, res) => {
  try {
    const { id, taskId } = req.params;
    await db.deleteSalonTask(taskId);

    const tasks = await db.getSalonTasks(id);
    io.to(`salon_${id}`).emit('salon_task_updated', { salonId: id, tasks });
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Fils (Threads / Message Threads)
app.get('/api/salons/:id/threads/:messageId', authenticateToken, async (req, res) => {
  try {
    const messages = await db.getThreadMessages(req.params.messageId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/:id/threads/:messageId', authenticateToken, async (req, res) => {
  try {
    const { id, messageId } = req.params;
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Le contenu du message est requis' });

    const threadMsgId = 'thread_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    await db.addThreadMessage({
      id: threadMsgId,
      parentMessageId: messageId,
      salonId: id,
      senderId: req.user.id,
      senderName: req.user.displayName || req.user.username,
      content: content.trim()
    });

    const threadMessages = await db.getThreadMessages(messageId);
    io.to(`salon_${id}`).emit('salon_thread_updated', { salonId: id, parentMessageId: messageId, messages: threadMessages });
    res.json({ success: true, threadMsgId, messages: threadMessages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Annonces (Broadcast Mode Toggle)
app.put('/api/salons/:id/broadcast', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { broadcastOnly } = req.body;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) return res.status(403).json({ error: 'Seul l\'administrateur du salon peut modifier ce mode' });

    await db.setSalonBroadcastOnly(id, broadcastOnly);
    io.to(`salon_${id}`).emit('salon_updated', { salonId: id, broadcastOnly: !!broadcastOnly });
    res.json({ success: true, broadcastOnly: !!broadcastOnly });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Décisions (Decision Log)
app.get('/api/salons/:id/decisions', authenticateToken, async (req, res) => {
  try {
    const decisions = await db.getSalonDecisions(req.params.id);
    res.json({ decisions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/:id/decisions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, sourceMessageId, responsibleId } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Le titre de la décision est requis' });

    // Check salon admin permission
    const salonObj = await db.getSalonById(id);
    const members = await db.getSalonMembers(id);
    const me = members ? members.find(m => m.id === req.user.id) : null;
    const isSalonAdmin = (salonObj && salonObj.created_by === req.user.id) || (me && me.role === 'admin') || req.user.role === 'admin';

    if (!isSalonAdmin) {
      return res.status(403).json({ error: 'Seuls les administrateurs du salon peuvent enregistrer une décision.' });
    }

    const decisionId = 'dec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    await db.createSalonDecision({
      id: decisionId,
      salonId: id,
      title: title.trim(),
      description: description ? description.trim() : '',
      sourceMessageId: sourceMessageId || null,
      responsibleId: responsibleId || null,
      decidedBy: req.user.id
    });

    const decisions = await db.getSalonDecisions(id);
    io.to(`salon_${id}`).emit('salon_decision_updated', { salonId: id, decisions });

    // Emit in-chat decision announcement card & Web Push
    try {
      let responsibleName = 'Toute l\'équipe';
      if (responsibleId) {
        const ids = responsibleId.split(',').map(s => s.trim()).filter(Boolean);
        if (ids.length > 0) {
          const names = [];
          for (const rId of ids) {
            const respUser = await db.getUserById(rId);
            if (respUser) names.push(respUser.display_name || respUser.username);
          }
          if (names.length > 0) responsibleName = names.join(', ');
        }
      }
      const creatorName = req.user.displayName || req.user.username;
      const annMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const annRecord = {
        id: annMsgId,
        channelType: 'salon',
        senderId: req.user.id,
        senderName: creatorName,
        receiverId: id,
        content: JSON.stringify({
          type: 'decision_announcement',
          isDecisionAnnouncement: true,
          decisionId: decisionId,
          title: title.trim(),
          description: description ? description.trim() : '',
          responsibleName: responsibleName,
          creatorName: creatorName,
          createdAt: new Date().toISOString()
        }),
        contextData: null,
        is_read: 0,
        timestamp: new Date().toISOString()
      };
      
      await db.saveMessage(annRecord);
      io.to(`salon_${id}`).emit('salon_message', annRecord);

      // Web Push notification to salon members
      const members = await db.getSalonMembers(id);
      const salonObj = await db.getSalonById(id);
      const salonName = salonObj ? salonObj.name : 'Salon';
      members.forEach(m => {
        if (m.id !== req.user.id) {
          pushService.sendNotificationToUser(m.id, {
            title: `📌 Décision Actée dans #${salonName}`,
            body: `${creatorName} a enregistré la décision : "${title.trim()}" (Responsable: ${responsibleName})`,
            icon: '/img/icon-192.png',
            data: { url: `/?salon=${id}`, channel: 'salon', salonId: id }
          }).catch(e => console.error('[-] Push error for decision:', e));
        }
      });
    } catch (e) {
      console.error('[-] Decision announcement error:', e);
    }

    res.json({ success: true, decisionId, decisions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/salons/:id/decisions/:decisionId', authenticateToken, async (req, res) => {
  try {
    const { id, decisionId } = req.params;

    // Check salon admin permission
    const salonObj = await db.getSalonById(id);
    const members = await db.getSalonMembers(id);
    const me = members ? members.find(m => m.id === req.user.id) : null;
    const isSalonAdmin = (salonObj && salonObj.created_by === req.user.id) || (me && me.role === 'admin') || req.user.role === 'admin';

    if (!isSalonAdmin) {
      return res.status(403).json({ error: 'Seuls les administrateurs du salon peuvent supprimer une décision.' });
    }

    await db.deleteSalonDecision(decisionId);

    const decisions = await db.getSalonDecisions(id);
    io.to(`salon_${id}`).emit('salon_decision_updated', { salonId: id, decisions });
    res.json({ success: true, decisions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Caisse (Finances & Mobile Money Ledger)
app.get('/api/salons/:id/finances', authenticateToken, async (req, res) => {
  try {
    const finances = await db.getSalonFinances(req.params.id);
    res.json({ finances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/:id/finances/target', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Seuls les administrateurs du salon peuvent définir l\'objectif financier.' });
    }

    const { targetAmount, currency } = req.body;
    await db.setSalonFinanceTarget(id, parseFloat(targetAmount) || 0, currency || 'FCFA');

    const finances = await db.getSalonFinances(id);
    io.to(`salon_${id}`).emit('salon_finance_updated', { salonId: id, finances });
    res.json({ success: true, finances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/:id/finances/transactions', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Seuls les administrateurs du salon peuvent enregistrer des transactions.' });
    }

    const { type, memberId, memberName, amount, category, receiptUrl, note } = req.body;
    if (!amount || parseFloat(amount) <= 0) return res.status(400).json({ error: 'Le montant doit être supérieur à zéro' });

    const txId = 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    await db.addSalonTransaction({
      id: txId,
      salonId: id,
      type: type === 'expense' ? 'expense' : 'contribution',
      memberId: memberId || req.user.id,
      memberName: memberName || req.user.displayName || req.user.username,
      amount: parseFloat(amount),
      category: category || 'Autre',
      receiptUrl: receiptUrl || null,
      note: note ? note.trim() : '',
      createdBy: req.user.id
    });

    const finances = await db.getSalonFinances(id);
    io.to(`salon_${id}`).emit('salon_finance_updated', { salonId: id, finances });
    res.json({ success: true, txId, finances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/salons/:id/finances/transactions/:txId', authenticateToken, async (req, res) => {
  try {
    const { id, txId } = req.params;
    const isAdmin = await db.isSalonAdmin(id, req.user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Seuls les administrateurs du salon peuvent supprimer des transactions.' });
    }

    await db.deleteSalonTransaction(txId);

    const finances = await db.getSalonFinances(id);
    io.to(`salon_${id}`).emit('salon_finance_updated', { salonId: id, finances });
    res.json({ success: true, finances });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== Direct 1-on-1 Modules REST Endpoints ====================

// 1. Micro-Contrat (Direct Contracts)
app.get('/api/direct/contracts', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.query;
    if (!contactId) return res.status(400).json({ error: 'contactId requis' });
    const contracts = await db.getDirectContracts(req.user.id, contactId);
    res.json({ contracts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/direct/contracts', authenticateToken, async (req, res) => {
  try {
    const { contactId, title, description, amount, currency, deadline } = req.body;
    if (!contactId || !title || !title.trim()) {
      return res.status(400).json({ error: 'Titre et destinataire requis' });
    }

    const contractId = 'ctr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    await db.createDirectContract({
      id: contractId,
      user1Id: req.user.id,
      user2Id: contactId,
      title: title.trim(),
      description: description ? description.trim() : '',
      amount: parseFloat(amount) || 0,
      currency: currency || 'FCFA',
      deadline: deadline || null,
      createdBy: req.user.id
    });

    const contracts = await db.getDirectContracts(req.user.id, contactId);
    io.to(`user_${req.user.id}`).to(`user_${contactId}`).emit('direct_contract_updated', {
      user1Id: req.user.id,
      user2Id: contactId,
      contracts
    });

    // In-chat interactive announcement card
    const senderName = req.user.displayName || req.user.username;
    const annMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const annRecord = {
      id: annMsgId,
      channelType: 'private',
      senderId: req.user.id,
      senderName: senderName,
      receiverId: contactId,
      content: JSON.stringify({
        type: 'direct_contract_card',
        contractId: contractId,
        title: title.trim(),
        description: description ? description.trim() : '',
        amount: parseFloat(amount) || 0,
        currency: currency || 'FCFA',
        deadline: deadline || null,
        status: 'pending',
        createdBy: req.user.id,
        senderName: senderName,
        text: `Micro-Contrat proposé : ${title.trim()} (${amount || 0} ${currency || 'FCFA'})`
      }),
      contextData: null,
      is_read: 0,
      timestamp: new Date().toISOString()
    };
    await db.saveMessage(annRecord);
    io.to(`user_${contactId}`).emit('private_message', annRecord);

    pushService.sendNotificationToUser(contactId, {
      title: `Micro-Contrat de ${senderName}`,
      body: `Proposition : "${title.trim()}" (${amount || 0} ${currency || 'FCFA'})`,
      icon: '/img/icon-192.png',
      data: { url: `/?contact=${req.user.id}`, channel: 'direct', contactId: req.user.id }
    }).catch(e => console.error('[-] Push contract error:', e));

    res.json({ success: true, contractId, contracts, contractRecord: annRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/direct/contracts/:id/action', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, contactId, note } = req.body;
    const contract = await db.getDirectContractById(id);
    if (!contract) return res.status(404).json({ error: 'Contrat introuvable' });

    let newStatus = 'pending';
    if (action === 'accept') newStatus = 'accepted';
    else if (action === 'adjust') newStatus = 'adjustment_requested';
    else if (action === 'complete') newStatus = 'completed';
    else if (action === 'reject' || action === 'cancel') newStatus = 'cancelled';

    await db.updateDirectContractStatus(id, newStatus, req.user.id);
    const contracts = await db.getDirectContracts(contract.user1_id, contract.user2_id);
    io.to(`user_${contract.user1_id}`).to(`user_${contract.user2_id}`).emit('direct_contract_updated', {
      user1Id: contract.user1_id,
      user2Id: contract.user2_id,
      contracts
    });

    const actorName = req.user.displayName || req.user.username;
    const targetUserId = (contract.user1_id === req.user.id) ? contract.user2_id : contract.user1_id;

    const actionTextMap = {
      accepted: `Micro-Contrat accepté et scellé par ${actorName}`,
      adjustment_requested: `${actorName} propose un ajustement : ${note || ''}`,
      completed: `Micro-Contrat marqué comme terminé par ${actorName}`,
      cancelled: `Micro-Contrat refusé / annulé par ${actorName}`
    };

    // In-chat interactive update card
    const annMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const annRecord = {
      id: annMsgId,
      channelType: 'private',
      senderId: req.user.id,
      senderName: actorName,
      receiverId: targetUserId,
      content: JSON.stringify({
        type: 'direct_contract_card',
        contractId: id,
        title: contract.title,
        description: contract.description || '',
        amount: contract.amount || 0,
        currency: contract.currency || 'FCFA',
        deadline: contract.deadline || null,
        status: newStatus,
        createdBy: contract.created_by,
        actionActor: actorName,
        actionNote: note || '',
        senderName: actorName,
        text: actionTextMap[newStatus] || `Micro-Contrat mis à jour`
      }),
      contextData: null,
      is_read: 0,
      timestamp: new Date().toISOString()
    };
    await db.saveMessage(annRecord);
    io.to(`user_${targetUserId}`).emit('private_message', annRecord);

    pushService.sendNotificationToUser(targetUserId, {
      title: `Micro-Contrat : ${contract.title}`,
      body: actionTextMap[newStatus] || `Mise à jour par ${actorName}`,
      icon: '/img/icon-192.png',
      data: { url: `/?contact=${req.user.id}`, channel: 'direct', contactId: req.user.id }
    }).catch(e => console.error('[-] Push error:', e));

    res.json({ success: true, status: newStatus, contracts, actionRecord: annRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/direct/contracts/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { contactId } = req.query;
    await db.deleteDirectContract(id, req.user.id);
    let contracts = [];
    if (contactId) {
      contracts = await db.getDirectContracts(req.user.id, contactId);
      io.to(`user_${req.user.id}`).to(`user_${contactId}`).emit('direct_contract_updated', {
        user1Id: req.user.id,
        user2Id: contactId,
        contracts
      });
    }
    res.json({ success: true, contracts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Échéances & Agenda (Direct Deadlines)
app.get('/api/direct/deadlines', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.query;
    if (!contactId) return res.status(400).json({ error: 'contactId requis' });
    const deadlines = await db.getDirectDeadlines(req.user.id, contactId);
    res.json({ deadlines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/direct/deadlines', authenticateToken, async (req, res) => {
  try {
    const { contactId, title, description, dueDate, type } = req.body;
    if (!contactId || !title || !dueDate) {
      return res.status(400).json({ error: 'Titre, destinataire et date requis' });
    }

    const deadlineId = 'dl_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    await db.createDirectDeadline({
      id: deadlineId,
      user1Id: req.user.id,
      user2Id: contactId,
      title: title.trim(),
      description: description ? description.trim() : '',
      dueDate: dueDate,
      type: type || 'deadline',
      createdBy: req.user.id
    });

    const deadlines = await db.getDirectDeadlines(req.user.id, contactId);
    io.to(`user_${req.user.id}`).to(`user_${contactId}`).emit('direct_deadline_updated', {
      user1Id: req.user.id,
      user2Id: contactId,
      deadlines
    });

    const senderName = req.user.displayName || req.user.username;
    pushService.sendNotificationToUser(contactId, {
      title: `Nouvelle Échéance : ${title.trim()}`,
      body: `Planifié par ${senderName} pour le ${new Date(dueDate).toLocaleDateString('fr-FR')}`,
      icon: '/img/icon-192.png',
      data: { url: `/?contact=${req.user.id}`, channel: 'direct', contactId: req.user.id }
    }).catch(e => console.error('[-] Push error:', e));

    res.json({ success: true, deadlineId, deadlines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/direct/deadlines/:id/toggle', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { contactId } = req.body;
    const newStatus = await db.toggleDirectDeadlineStatus(id);
    if (!newStatus) return res.status(404).json({ error: 'Échéance introuvable' });

    if (contactId) {
      const deadlines = await db.getDirectDeadlines(req.user.id, contactId);
      io.to(`user_${req.user.id}`).to(`user_${contactId}`).emit('direct_deadline_updated', {
        user1Id: req.user.id,
        user2Id: contactId,
        deadlines
      });
    }

    res.json({ success: true, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/direct/deadlines/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { contactId } = req.query;
    await db.deleteDirectDeadline(id);

    if (contactId) {
      const deadlines = await db.getDirectDeadlines(req.user.id, contactId);
      io.to(`user_${req.user.id}`).to(`user_${contactId}`).emit('direct_deadline_updated', {
        user1Id: req.user.id,
        user2Id: contactId,
        deadlines
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Épingles Personnelles (Direct User Pins)
app.get('/api/direct/pins', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.query;
    if (!contactId) return res.status(400).json({ error: 'contactId requis' });
    const pins = await db.getUserDirectPins(req.user.id, contactId);
    res.json({ pins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/direct/pins', authenticateToken, async (req, res) => {
  try {
    const { contactId, title, content, category } = req.body;
    if (!contactId || !title || !content) {
      return res.status(400).json({ error: 'Titre et contenu requis' });
    }

    const pinId = 'pin_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    await db.createUserDirectPin({
      id: pinId,
      userId: req.user.id,
      contactId: contactId,
      title: title.trim(),
      content: content.trim(),
      category: category || 'note'
    });

    const pins = await db.getUserDirectPins(req.user.id, contactId);
    res.json({ success: true, pinId, pins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/direct/pins/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await db.deleteUserDirectPin(id, req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Règlements & Quittances (Direct Payments)
app.get('/api/direct/payments', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.query;
    if (!contactId) return res.status(400).json({ error: 'contactId requis' });
    const payments = await db.getDirectPayments(req.user.id, contactId);
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/direct/payments', authenticateToken, async (req, res) => {
  try {
    const { contactId, contractId, amount, currency, paymentMethod, reference, receiptUrl, note } = req.body;
    if (!contactId || !amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'Montant et destinataire requis' });
    }

    const paymentId = 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    await db.createDirectPayment({
      id: paymentId,
      user1Id: req.user.id,
      user2Id: contactId,
      contractId: contractId || null,
      amount: parseFloat(amount),
      currency: currency || 'FCFA',
      paymentMethod: paymentMethod || 'Mobile Money',
      reference: reference ? reference.trim() : '',
      receiptUrl: receiptUrl || null,
      note: note ? note.trim() : '',
      paidBy: req.user.id
    });

    const payments = await db.getDirectPayments(req.user.id, contactId);
    io.to(`user_${req.user.id}`).to(`user_${contactId}`).emit('direct_payment_updated', {
      user1Id: req.user.id,
      user2Id: contactId,
      payments
    });

    const senderName = req.user.displayName || req.user.username;
    const annMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const annRecord = {
      id: annMsgId,
      channelType: 'private',
      senderId: req.user.id,
      senderName: senderName,
      receiverId: contactId,
      content: JSON.stringify({
        type: 'direct_payment_card',
        paymentId: paymentId,
        amount: parseFloat(amount),
        currency: currency || 'FCFA',
        paymentMethod: paymentMethod || 'Mobile Money',
        reference: reference || '',
        note: note || '',
        status: 'declared',
        paidBy: req.user.id,
        senderName: senderName,
        text: `Versement déclaré : ${amount} ${currency || 'FCFA'} via ${paymentMethod || 'Mobile Money'}`
      }),
      contextData: null,
      is_read: 0,
      timestamp: new Date().toISOString()
    };
    await db.saveMessage(annRecord);
    io.to(`user_${contactId}`).emit('private_message', annRecord);

    pushService.sendNotificationToUser(contactId, {
      title: `Paiement déclaré par ${senderName}`,
      body: `Montant : ${amount} ${currency || 'FCFA'} (${paymentMethod || 'Mobile Money'}) - Cliquez pour confirmer réception`,
      icon: '/img/icon-192.png',
      data: { url: `/?contact=${req.user.id}`, channel: 'direct', contactId: req.user.id }
    }).catch(e => console.error('[-] Push error:', e));

    res.json({ success: true, paymentId, payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/direct/payments/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { contactId } = req.body;
    await db.confirmDirectPayment(id, req.user.id);

    const payments = await db.getDirectPayments(req.user.id, contactId);
    io.to(`user_${req.user.id}`).to(`user_${contactId}`).emit('direct_payment_updated', {
      user1Id: req.user.id,
      user2Id: contactId,
      payments
    });

    const confirmerName = req.user.displayName || req.user.username;
    pushService.sendNotificationToUser(contactId, {
      title: `Réception de paiement confirmée`,
      body: `${confirmerName} a confirmé la bonne réception des fonds !`,
      icon: '/img/icon-192.png',
      data: { url: `/?contact=${req.user.id}`, channel: 'direct', contactId: req.user.id }
    }).catch(e => console.error('[-] Push error:', e));

    res.json({ success: true, payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Coffre-fort Documents & Médias Partagés (Direct Files)
app.get('/api/direct/files', authenticateToken, async (req, res) => {
  try {
    const { contactId } = req.query;
    if (!contactId) return res.status(400).json({ error: 'contactId requis' });
    const files = await db.getDirectFiles(req.user.id, contactId);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3e. Collaborative Salon Endpoints: Files, Pinned Messages, Polls & Meetings
app.get('/api/salons/:id/files', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const files = await db.getSalonMediaFiles(id);
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/:id/pin-message', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { messageId } = req.body;
    const pinnedMessage = await db.setUniversalPinnedMessage('salon', id, messageId || null);
    io.to(`salon_${id}`).emit('salon_pinned_update', {
      salonId: id,
      messageId: messageId || null,
      message: pinnedMessage
    });
    res.json({ success: true, pinnedMessage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getPrivatePairKey(id1, id2) {
  return [String(id1), String(id2)].sort().join('_');
}

app.post('/api/chat/pin-message', authenticateToken, async (req, res) => {
  try {
    const { channelType, targetId, messageId, action = 'pin' } = req.body;
    if (!channelType || !targetId) {
      return res.status(400).json({ error: 'channelType et targetId sont requis' });
    }

    let actualTargetId = targetId;
    if (channelType === 'private') {
      actualTargetId = getPrivatePairKey(req.user.id, targetId);
    }

    const pinnedMessages = await db.setUniversalPinnedMessage(channelType, actualTargetId, messageId, action);
    
    // Broadcast to room & participants
    if (channelType === 'salon') {
      io.to(`salon_${targetId}`).emit('chat_pinned_update', { channelType, targetId, pinnedMessages });
      io.to(`salon_${targetId}`).emit('salon_pinned_update', { salonId: targetId, pinnedMessages });
    } else if (channelType === 'private') {
      io.to(`user_${targetId}`).emit('chat_pinned_update', { channelType, targetId: req.user.id, pinnedMessages });
      io.to(`user_${req.user.id}`).emit('chat_pinned_update', { channelType, targetId, pinnedMessages });
    } else {
      io.to(`user_${targetId}`).emit('chat_pinned_update', { channelType, targetId, pinnedMessages });
      io.to('admin_room').emit('chat_pinned_update', { channelType, targetId, pinnedMessages });
    }

    res.json({ success: true, pinnedMessages });
  } catch (err) {
    console.error('[-] Error pinning message:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/chat/pinned-messages', authenticateToken, async (req, res) => {
  try {
    const { channelType, targetId } = req.query;
    if (!channelType || !targetId) {
      return res.status(400).json({ error: 'channelType et targetId sont requis' });
    }

    let actualTargetId = targetId;
    if (channelType === 'private') {
      actualTargetId = getPrivatePairKey(req.user.id, targetId);
    }

    const pinnedMessages = await db.getUniversalPinnedMessages(channelType, actualTargetId);
    res.json({ pinnedMessages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/:id/polls/create', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { question, options } = req.body;
    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ error: 'La question et au moins 2 options sont requises' });
    }
    const pollId = `poll_${uuidv4()}`;
    const cleanOptions = options.map(o => String(o).trim()).filter(Boolean);
    const poll = await db.createPoll({
      id: pollId,
      salonId: id,
      creatorId: req.user.id,
      question: question.trim(),
      options: cleanOptions
    });

    // Save a special poll message in channel
    const pollMsgId = `msg_${uuidv4()}`;
    const pollData = {
      type: 'poll',
      pollId: pollId,
      text: `[Sondage] ${question.trim()}`
    };

    await db.saveMessage({
      id: pollMsgId,
      senderId: req.user.id,
      senderName: req.user.displayName || req.user.username,
      receiverId: id,
      channelType: 'salon',
      content: JSON.stringify(pollData)
    });

    const msgRecord = {
      id: pollMsgId,
      senderId: req.user.id,
      sender_id: req.user.id,
      senderName: req.user.displayName || req.user.username,
      sender_name: req.user.displayName || req.user.username,
      receiverId: id,
      receiver_id: id,
      channelType: 'salon',
      channel_type: 'salon',
      content: JSON.stringify(pollData),
      pollId: pollId,
      poll_id: pollId,
      timestamp: new Date().toISOString()
    };

    io.to(`salon_${id}`).emit('new_salon_message', msgRecord);

    io.to(`salon_${id}`).emit('salon_poll_created', {
      salonId: id,
      poll: poll,
      messageId: pollMsgId,
      senderName: req.user.displayName || req.user.username
    });

    res.json({ success: true, poll });
  } catch (err) {
    console.error('[-] Error creating poll:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/polls/:id/vote', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { optionIndex } = req.body;
    if (optionIndex === undefined || optionIndex === null) {
      return res.status(400).json({ error: 'Option invalide' });
    }
    const poll = await db.votePoll(id, req.user.id, optionIndex);
    if (poll) {
      io.to(`salon_${poll.salon_id}`).emit('poll_vote_update', {
        poll: poll
      });
    }
    res.json({ success: true, poll });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/polls/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const poll = await db.getPollById(id);
    if (!poll) return res.status(404).json({ error: 'Sondage introuvable' });
    res.json({ poll });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/salons/:id/meeting/start', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const salon = await db.getSalonById(id);
    if (!salon) return res.status(404).json({ error: 'Salon introuvable' });

    const roomName = `DigiCom_Salon_${id}`;
    const senderName = req.user.displayName || req.user.username;
    
    // Save meeting invitation message in salon
    const msgId = `msg_${uuidv4()}`;
    const meetingData = {
      type: 'meeting',
      roomName: roomName,
      startedBy: senderName,
      text: `[Réunion] ${senderName} a démarré une réunion vidéo de salon.`
    };

    await db.saveMessage({
      id: msgId,
      senderId: req.user.id,
      senderName: senderName,
      receiverId: id,
      channelType: 'salon',
      content: JSON.stringify(meetingData)
    });

    const msgRecord = {
      id: msgId,
      senderId: req.user.id,
      sender_id: req.user.id,
      senderName: senderName,
      sender_name: senderName,
      receiverId: id,
      receiver_id: id,
      channelType: 'salon',
      channel_type: 'salon',
      content: JSON.stringify(meetingData),
      timestamp: new Date().toISOString()
    };

    io.to(`salon_${id}`).emit('new_salon_message', msgRecord);

    // Broadcast socket event
    io.to(`salon_${id}`).emit('salon_meeting_started', {
      salonId: id,
      salonName: salon.name,
      roomName: roomName,
      startedBy: senderName,
      startedById: req.user.id
    });

    // Notify all members via push
    const members = await db.getSalonMembers(id);
    for (const m of members) {
      if (m.id !== req.user.id) {
        pushService.sendNotificationToUser(m.id, {
          title: `Réunion: ${salon.name}`,
          body: `${senderName} a démarré une réunion vidéo. Cliquez pour rejoindre.`,
          icon: '/img/icon-192.png',
          badge: '/img/icon-192.png',
          data: {
            url: `/?openSalonMeeting=true&salonId=${id}&roomName=${encodeURIComponent(roomName)}`
          }
        }).catch(err => console.error('[-] Push error for salon meeting:', err));
      }
    }

    res.json({ success: true, roomName });
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
app.post('/api/logout', async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) {
      await db.deleteSubscriptionByEndpoint(endpoint);
    }
  } catch (e) {}
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

// ----------------------------------------------------
// SuperAdmin Control API Endpoints
// ----------------------------------------------------
app.get('/api/admin/metrics', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé au SuperAdmin.' });
    }
    const metrics = await db.getAdminMetrics();
    const onlineSocketsCount = onlineUsers.size;

    const userTabCounts = {};
    for (const uid of onlineUsers.values()) {
      userTabCounts[uid] = (userTabCounts[uid] || 0) + 1;
    }

    const onlineUserIds = Object.keys(userTabCounts);
    const onlineUsersList = [];

    for (const uid of onlineUserIds) {
      const u = await db.getUserById(uid);
      if (u) {
        onlineUsersList.push({
          id: u.id,
          username: u.username,
          displayName: u.display_name,
          role: u.role,
          activeTabs: userTabCounts[uid]
        });
      }
    }
    
    const mem = process.memoryUsage();
    const memoryMb = Math.round(mem.rss / (1024 * 1024));
    const uptimeHours = Math.round((process.uptime() / 3600) * 10) / 10;

    res.json({
      success: true,
      metrics: {
        ...metrics,
        online_sockets: onlineSocketsCount,
        online_users_count: onlineUserIds.length,
        server_memory_mb: memoryMb,
        server_uptime_hours: uptimeHours
      },
      online_users_list: onlineUsersList
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé au SuperAdmin.' });
    }
    const users = await db.getAllUsersForAdmin();
    const onlineUserIds = Array.from(new Set(Array.from(onlineUsers.values())));
    
    const enrichedUsers = users.map(u => ({
      ...u,
      is_online: onlineUserIds.includes(u.id)
    }));

    res.json({ success: true, users: enrichedUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/ban', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé au SuperAdmin.' });
    }
    const { userId, banState } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requis.' });
    if (userId === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas vous bannir vous-même.' });

    await db.banUser(userId, banState);

    if (banState) {
      for (const [sockId, uid] of onlineUsers.entries()) {
        if (uid === userId) {
          const socketInstance = io.sockets.sockets.get(sockId);
          if (socketInstance) {
            socketInstance.emit('force_disconnect', { reason: 'Votre compte a été banni par le SuperAdmin.' });
            socketInstance.disconnect(true);
          }
        }
      }
    }

    res.json({ success: true, is_banned: banState ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/nuke/:userId', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé au SuperAdmin.' });
    }
    const { userId } = req.params;
    if (userId === req.user.id) return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte SuperAdmin.' });

    for (const [sockId, uid] of onlineUsers.entries()) {
      if (uid === userId) {
        const socketInstance = io.sockets.sockets.get(sockId);
        if (socketInstance) {
          socketInstance.emit('force_disconnect', { reason: 'Votre compte et vos données ont été définitivement supprimés.' });
          socketInstance.disconnect(true);
        }
      }
    }

    const nukeResult = await db.nukeUser(userId);

    if (nukeResult.filesToUnlink && nukeResult.filesToUnlink.length > 0) {
      nukeResult.filesToUnlink.forEach(relPath => {
        try {
          const fullPath = path.join(__dirname, '../public', relPath);
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } catch (e) {}
      });
    }

    res.json({ success: true, message: 'Utilisateur et l\'ensemble de ses données purgés avec succès.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/broadcast', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé au SuperAdmin.' });
    }
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Message d\'annonce requis.' });

    io.emit('admin_announcement', {
      content: message.trim(),
      timestamp: new Date().toISOString()
    });

    res.json({ success: true, message: 'Annonce diffusée à tous les utilisateurs connectés.' });
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

    // Try extracting authenticated user token if present in headers or cookies
    let subUserId = userId;
    const authHeader = req.headers['authorization'];
    const token = (authHeader && authHeader.split(' ')[1]) || (req.cookies && req.cookies.digicom_token);
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.id) subUserId = decoded.id;
      } catch (e) {}
    }

    if (!subUserId) {
      subUserId = 'guest';
    }

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

// 8b. Unsubscribe Push Endpoint (Call on logout or toggle off)
app.post('/api/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body || {};
    if (endpoint) {
      await db.deleteSubscriptionByEndpoint(endpoint);
    }
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
    const { limit, before } = req.query;
    await db.markMessagesAsRead(req.user.id, targetUserId);
    io.to(`user_${targetUserId}`).emit('messages_read_by_recipient', { readerId: req.user.id });
    const messages = await db.getDirectMessages(req.user.id, targetUserId, req.user.role, limit || 50, before || null);
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
    const { senderId, limit, before } = req.query;
    if (!senderId || senderId === 'undefined' || senderId === 'null' || String(senderId).trim() === '') {
      return res.json({ messages: [] });
    }
    await db.markSupportMessagesAsRead(senderId);
    io.to(`support_${senderId}`).emit('support_read_receipt', { senderId });
    io.to('admin_room').emit('support_read_receipt', { senderId });
    const messages = await db.getMessages({
      channelType: 'support',
      limit: limit || 50,
      before: before || null,
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

    socket.emit('presence_initial', {
      onlineUserIds: Array.from(onlineUsers.keys())
    });
    socket.emit('presence_update', {
      userId: userData.id,
      status: 'online',
      onlineUserIds: Array.from(onlineUsers.keys())
    });
    socket.broadcast.emit('presence_delta', {
      userId: userData.id,
      status: 'online'
    });

    logger.info('SOCKET', `User connected: ${userData.username || userData.id} (role: ${userData.role || 'user'})`, { socketId: socket.id, userId: userData.id });
  });

  // Direct 1-to-1 Private Message (Hermetic & Private between Sender and Receiver)
  socket.on('private_message', async (data) => {
    try {
      const msgId = data.id || 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const senderId = currentUser ? currentUser.id : data.senderId;
      const senderName = currentUser ? (currentUser.displayName || currentUser.username) : data.senderName;
      const receiverId = data.receiverId;

      if (!receiverId) {
        logger.warn('MESSAGE', 'Missing receiverId in private_message', { senderId });
        return;
      }

      logger.info('MESSAGE', `Private message from ${senderName} (${senderId}) -> ${receiverId}`, { msgId });

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

      // Always send Web Push notification so user receives it in background/lockscreen
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
        icon: '/img/icon-192.webp',
        badge: '/img/badge-72.webp',
        tag: `contact-${senderId}`,
        data: {
          url: `/?contact=${senderId}&msg=${messageRecord.id}`,
          channel: 'direct',
          senderId: senderId,
          contactId: senderId,
          senderName: senderName,
          messageId: messageRecord.id
        }
      }).catch(err => console.error('[-] Push error for private message:', err));
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
        socket.leave(`active_chat_${socket.activeChatPartner}`);
      }
      socket.activeChatPartner = partnerId;
      socket.join(`active_chat_${currentUserId}_${partnerId}`);
      if (partnerId.startsWith('admin_')) {
        socket.join(`active_chat_${partnerId}`);
      }
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
        if (targetPartner.startsWith('admin_')) {
          socket.leave(`active_chat_${targetPartner}`);
        }
      }
      if (socket.activeChatPartner) {
        socket.leave(`active_chat_${currentUserId}_${socket.activeChatPartner}`);
        if (socket.activeChatPartner.startsWith('admin_')) {
          socket.leave(`active_chat_${socket.activeChatPartner}`);
        }
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

  socket.on('salon_mark_read', async (data) => {
    try {
      const { salonId } = data || {};
      const currentUserId = socket.userId || (socket.user ? socket.user.id : null) || (currentUser ? currentUser.id : null);
      if (salonId && currentUserId) {
        await db.markSalonMessagesAsRead(salonId, currentUserId);
        const currentUserName = (currentUser && (currentUser.displayName || currentUser.username)) || 'Membre';
        io.to(`salon_${salonId}`).emit('salon_messages_read', {
          salonId,
          readerId: currentUserId,
          readerName: currentUserName
        });
      }
    } catch (err) {
      console.error('[-] Error handling salon_mark_read:', err);
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

      // Check if broadcast_only (Annonces) mode is active and user is not admin
      const salonRecord = await db.getSalonById(salonId);
      if (salonRecord && salonRecord.broadcast_only) {
        const isAdmin = await db.isSalonAdmin(salonId, senderId);
        if (!isAdmin) {
          socket.emit('salon_error', {
            salonId,
            message: 'Ce Salon est en mode Annonces : seuls les administrateurs peuvent publier.'
          });
          return;
        }
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

      // Deliver directly to each salon member room & send push if not actively viewing
      const salonMembers = await db.getSalonMembers(salonId);
      const activeMemberIds = [];
      for (const member of salonMembers) {
        if (member.id !== senderId) {
          const activeSalonRoom = io.sockets.adapter.rooms.get(`active_chat_${member.id}_${salonId}`);
          if (activeSalonRoom && activeSalonRoom.size > 0) {
            activeMemberIds.push(member.id);
          }
        }
      }

      const isReadByActiveMembers = activeMemberIds.length > 0;

      const messageRecord = {
        id: msgId,
        channelType: 'salon',
        senderId: senderId,
        senderName: senderName || 'Membre',
        receiverId: salonId,
        content: typeof contentToSave === 'object' ? JSON.stringify(contentToSave) : contentToSave,
        contextData: data.contextData || null,
        is_read: isReadByActiveMembers ? 1 : 0,
        read_count: activeMemberIds.length,
        timestamp: new Date().toISOString()
      };

      await db.saveMessage(messageRecord);

      if (isReadByActiveMembers) {
        await db.markSalonMessageReadByMembers(salonId, messageRecord.id, activeMemberIds);
        io.to(`salon_${salonId}`).emit('salon_messages_read', {
          salonId,
          readerId: activeMemberIds[0],
          readerName: 'Membre actif'
        });
      }

      // Broadcast message to all members currently in the salon room
      io.to(`salon_${salonId}`).emit('new_salon_message', messageRecord);

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
          const isMemberActiveInSalon = activeMemberIds.includes(member.id);

          const isMentioned = member.username && (mentionedUsernames.has(member.username.toLowerCase()) || (member.display_name && mentionedUsernames.has(member.display_name.toLowerCase())));
          const notificationTitle = isMentioned
            ? `${formattedSalonName} • ${senderName} vous a mentionné`
            : `${formattedSalonName} • ${senderName}`;

          pushService.sendNotificationToUser(member.id, {
            title: notificationTitle,
            body: pushBody.length > 70 ? pushBody.substring(0, 70) + '...' : pushBody,
            icon: '/img/icon-192.webp',
            badge: '/img/badge-72.webp',
            tag: `salon-${salonId}`,
            data: {
              url: `/?salon=${salonId}&msg=${messageRecord.id}`,
              channel: 'salon',
              salonId: salonId,
              salonName: formattedSalonName,
              senderName: senderName,
              messageId: messageRecord.id
            }
          }).catch(e => console.error('[-] Push error to salon member:', e));
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
        await db.markSupportMessagesAsRead(senderId);
        io.to(`support_${senderId}`).emit('support_read_receipt', { senderId });
        io.to('admin_room').emit('support_read_receipt', { senderId });
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
        body: courseTitle ? `[${courseTitle}] : ${data.content}` : (typeof data.content === 'string' ? data.content : 'Demande d\'assistance'),
        icon: '/img/icon-192.webp',
        badge: '/img/badge-72.webp',
        tag: `support-${senderId}`,
        data: {
          url: `/?channel=support&sender=${senderId}&msg=${msgId}`,
          channel: 'support',
          senderId: senderId,
          messageId: msgId
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
        await db.markSupportMessagesAsRead(targetUserId);
        io.to(`support_${targetUserId}`).emit('support_read_receipt', { senderId: targetUserId });
        io.to('admin_room').emit('support_read_receipt', { senderId: targetUserId });
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

      // Send high-priority Web Push Notification for background call alert
      pushService.sendNotificationToUser(data.targetUserId, {
        title: `Appel ${data.callType === 'video' ? 'Vidéo' : 'Vocal'} Entrant`,
        body: `${callerName} vous appelle... Touchez pour répondre.`,
        icon: '/img/icon-192.png',
        badge: '/img/badge-72.png',
        data: {
          type: 'call_incoming',
          callerId: callerId,
          callerName: callerName,
          callType: data.callType || 'audio',
          url: `/?contact=${encodeURIComponent(callerId)}`
        }
      }).catch(e => console.error('[-] Push error for call_incoming:', e));
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
      const callerId = socket.user ? socket.user.id : socket.userId;
      const callerName = socket.user ? (socket.user.displayName || socket.user.username) : 'Membre';

      io.to(`user_${data.targetUserId}`).emit('call_rejected', {
        reason: data.reason || 'Appel refusé'
      });

      // Send Missed Call Push Notification if call was missed/unanswered
      if (data.isMissed) {
        pushService.sendNotificationToUser(data.targetUserId, {
          title: 'Appel Manqué',
          body: `Appel ${data.callType === 'video' ? 'vidéo' : 'vocal'} manqué de ${callerName}.`,
          icon: '/img/icon-192.png',
          badge: '/img/badge-72.png',
          data: { url: `/?contact=${encodeURIComponent(callerId)}` }
        }).catch(e => console.error('[-] Push error for missed call:', e));
      }
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

  const cleanupSocket = (reason) => {
    const targetUserId = (currentUser && currentUser.id) || socket.userId;

    if (targetUserId && onlineUsers.has(targetUserId)) {
      const userSockets = onlineUsers.get(targetUserId);
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(targetUserId);
        io.emit('presence_delta', {
          userId: targetUserId,
          status: 'offline'
        });
        io.emit('presence_update', {
          userId: targetUserId,
          status: 'offline',
          onlineUserIds: Array.from(onlineUsers.keys())
        });
      }
    } else {
      for (const [uId, socketSet] of onlineUsers.entries()) {
        if (socketSet.has(socket.id)) {
          socketSet.delete(socket.id);
          if (socketSet.size === 0) {
            onlineUsers.delete(uId);
            io.emit('presence_delta', { userId: uId, status: 'offline' });
          }
        }
      }
    }

    if (socket.activeCallTarget) {
      io.to(`user_${socket.activeCallTarget}`).emit('call_ended', { reason: 'peer_disconnected' });
      socket.activeCallTarget = null;
    }

    if (socket.activeChatPartner && targetUserId) {
      socket.leave(`active_chat_${targetUserId}_${socket.activeChatPartner}`);
      socket.activeChatPartner = null;
    }

    console.log(`[-] Socket cleaned up (${reason}): ${socket.id}`);
  };

  socket.on('disconnect', (reason) => cleanupSocket(`disconnect: ${reason}`));
  socket.on('error', (err) => cleanupSocket(`error: ${err ? err.message : 'unknown'}`));
});

// Automatic Asset Minification (AST-based, 100% loss-free)
const buildMinifiedAssets = require('./build-minify');
try {
  buildMinifiedAssets();
} catch (e) {
  console.warn('[-] Error during asset minification on startup:', e);
}

// Daily Automated Task Reminder Checker
async function checkDailyTaskReminders() {
  try {
    const todayDateStr = new Date().toISOString().split('T')[0];
    const tasksDue = await db.getTasksDueForReminder(todayDateStr);
    
    for (const task of tasksDue) {
      const assignedName = task.assigned_name || task.assigned_username || 'Toute l\'équipe';
      const annMsgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      
      const annRecord = {
        id: annMsgId,
        channelType: 'salon',
        senderId: 'system',
        senderName: 'Système Salon',
        receiverId: task.salon_id,
        content: JSON.stringify({
          type: 'task_reminder',
          isTaskAnnouncement: true,
          action: 'reminder',
          taskId: task.id,
          title: task.title,
          assignedName: assignedName,
          assignedTo: task.assigned_to,
          dueDate: task.due_date,
          text: `⏰ Rappel : La tâche "${task.title}" (Assignée à : ${assignedName}) est prévue pour aujourd'hui !`
        }),
        contextData: null,
        is_read: 0,
        timestamp: new Date().toISOString()
      };
      
      await db.saveMessage(annRecord);
      io.to(`salon_${task.salon_id}`).emit('salon_message', annRecord);

      // Targeted Web Push Notification specifically to assigned user
      if (task.assigned_to) {
        pushService.sendNotificationToUser(task.assigned_to, {
          title: `⏰ Rappel de Tâche (Aujourd'hui)`,
          body: `La tâche "${task.title}" est prévue pour aujourd'hui ! Cliquez pour mettre à jour son statut.`,
          icon: '/img/icon-192.png',
          data: { url: `/?salon=${task.salon_id}`, channel: 'salon', salonId: task.salon_id }
        }).catch(e => console.error('[-] Push error for task reminder:', e));
      }

      await db.updateTaskReminderDate(task.id, todayDateStr);
    }
  } catch (err) {
    console.error('[-] Error checking daily task reminders:', err);
  }
}

// Mutual Push Reminders for Direct 1-on-1 Deadlines (Anti-Oubli)
async function checkDirectDeadlinesReminders() {
  try {
    const todayDateStr = new Date().toISOString().split('T')[0];
    const deadlinesDue = await db.getDirectDeadlinesDueForReminder();

    for (const item of deadlinesDue) {
      const u1 = await db.getUserById(item.user1_id);
      const u2 = await db.getUserById(item.user2_id);
      const u1Name = u1 ? (u1.display_name || u1.username) : 'Votre contact';
      const u2Name = u2 ? (u2.display_name || u2.username) : 'Votre contact';

      // Push to user1
      pushService.sendNotificationToUser(item.user1_id, {
        title: `Échéance Partagée avec ${u2Name}`,
        body: `Rappel : "${item.title}" est prévue pour aujourd'hui !`,
        icon: '/img/icon-192.png',
        data: { url: `/?contact=${item.user2_id}`, channel: 'direct', contactId: item.user2_id }
      }).catch(e => console.error('[-] Push deadline error u1:', e));

      // Push to user2
      pushService.sendNotificationToUser(item.user2_id, {
        title: `Échéance Partagée avec ${u1Name}`,
        body: `Rappel : "${item.title}" est prévue pour aujourd'hui !`,
        icon: '/img/icon-192.png',
        data: { url: `/?contact=${item.user1_id}`, channel: 'direct', contactId: item.user1_id }
      }).catch(e => console.error('[-] Push deadline error u2:', e));

      await db.updateDirectDeadlineReminderDate(item.id, todayDateStr);
    }
  } catch (err) {
    console.error('[-] Error checking direct deadline reminders:', err);
  }
}

// Run task reminder & direct deadline check on startup and every 30 minutes
setTimeout(checkDailyTaskReminders, 10000);
setInterval(checkDailyTaskReminders, 30 * 60 * 1000);
setTimeout(checkDirectDeadlinesReminders, 15000);
setInterval(checkDirectDeadlinesReminders, 15 * 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` 🚀 DigiCom Server is running on port ${PORT}`);
  console.log(` 🔒 E2EE & VAPID Sovereign Realtime Engine Ready`);
  console.log(`====================================================`);
});
