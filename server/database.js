const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'digicom.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[-] Failed to connect to SQLite database:', err.message);
  } else {
    console.log('[+] Connected to SQLite database at:', dbPath);
    db.serialize(() => {
      db.run('PRAGMA journal_mode = WAL;');
      db.run('PRAGMA synchronous = NORMAL;');
      db.run('PRAGMA busy_timeout = 5000;');
      db.run('PRAGMA cache_size = -20000;');
      db.run('PRAGMA temp_store = MEMORY;');
    });
    initTables();
  }
});

// Helper for promisified queries
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initTables() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'family',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      receiver_id TEXT,
      content TEXT NOT NULL,
      context_data TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Index for fast message lookup
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_type, timestamp)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_direct_pair ON messages(channel_type, sender_id, receiver_id, timestamp)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_direct_reverse ON messages(channel_type, receiver_id, sender_id, timestamp)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_salon ON messages(channel_type, receiver_id, timestamp)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, is_read, deleted_scope)`);

  try {
    await run(`ALTER TABLE messages ADD COLUMN deleted_scope TEXT DEFAULT NULL`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE messages ADD COLUMN deleted_by TEXT DEFAULT NULL`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE messages ADD COLUMN deleted_at DATETIME DEFAULT NULL`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE messages ADD COLUMN is_edited INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0`);
  } catch (e) {}
  await run(`
    CREATE TABLE IF NOT EXISTS user_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, contact_id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_user_contacts_user ON user_contacts(user_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS contact_requests (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sender_id, receiver_id)
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_contact_req_receiver ON contact_requests(receiver_id, status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_contact_req_sender ON contact_requests(sender_id, status)`);

  // Auto-migration: Populate user_contacts from existing messages so no existing conversations are lost
  try {
    await run(`
      INSERT OR IGNORE INTO user_contacts (user_id, contact_id)
      SELECT DISTINCT sender_id, receiver_id FROM messages WHERE receiver_id IS NOT NULL AND sender_id != receiver_id
    `);
    await run(`
      INSERT OR IGNORE INTO user_contacts (user_id, contact_id)
      SELECT DISTINCT receiver_id, sender_id FROM messages WHERE receiver_id IS NOT NULL AND sender_id != receiver_id
    `);
  } catch (e) {}

  // Salons (Confidential Group Workspaces) Tables
  await run(`
    CREATE TABLE IF NOT EXISTS salons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '🛡️',
      created_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS salon_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      salon_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      is_blocked INTEGER DEFAULT 0,
      last_read_at DATETIME,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(salon_id, user_id)
    )
  `);
  try {
    await run(`ALTER TABLE salon_members ADD COLUMN is_blocked INTEGER DEFAULT 0`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE salon_members ADD COLUMN last_read_at DATETIME`);
  } catch (e) {}
  try {
    await run(`ALTER TABLE salons ADD COLUMN pinned_message_id TEXT`);
  } catch (e) {}

  await run(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      creator_id TEXT NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_polls_salon ON polls(salon_id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS poll_votes (
      poll_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      option_index INTEGER NOT NULL,
      voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(poll_id, user_id)
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pinned_messages_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pinned_unique_v2 ON pinned_messages_v2(channel_type, target_id, message_id)`);

  console.log('[+] Database tables & indexes initialized successfully.');
}

// User Helpers
async function getUserCount() {
  const row = await get('SELECT COUNT(*) as count FROM users');
  return row ? row.count : 0;
}

async function createUser({ id, username, displayName, passwordHash, role = 'family' }) {
  return await run(
    `INSERT INTO users (id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
    [id, username.toLowerCase().trim(), displayName || username, passwordHash, role]
  );
}

async function getUserByUsername(username) {
  return await get(`SELECT * FROM users WHERE username = ?`, [username.toLowerCase().trim()]);
}

async function getUserById(id) {
  return await get(`SELECT id, username, display_name, role, COALESCE(is_banned, 0) as is_banned, created_at FROM users WHERE id = ?`, [id]);
}

async function getAllUsers() {
  return await all(`SELECT id, username, display_name, role, COALESCE(is_banned, 0) as is_banned, created_at FROM users ORDER BY created_at ASC`);
}

async function updateUser(id, { username, displayName, passwordHash, role }) {
  if (passwordHash) {
    return await run(
      `UPDATE users SET username = ?, display_name = ?, password_hash = ?, role = COALESCE(?, role) WHERE id = ?`,
      [username.toLowerCase().trim(), displayName || username, passwordHash, role, id]
    );
  } else {
    return await run(
      `UPDATE users SET username = ?, display_name = ?, role = COALESCE(?, role) WHERE id = ?`,
      [username.toLowerCase().trim(), displayName || username, role, id]
    );
  }
}

async function deleteUser(id) {
  // Delete user's messages, subscriptions and user entry
  await run(`DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?`, [id, id]);
  await run(`DELETE FROM push_subscriptions WHERE user_id = ?`, [id]);
  return await run(`DELETE FROM users WHERE id = ?`, [id]);
}

// Push Subscriptions Helpers
async function saveSubscription({ userId, endpoint, p256dh, auth }) {
  return await run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      created_at = CURRENT_TIMESTAMP`,
    [userId, endpoint, p256dh, auth]
  );
}

async function getSubscriptionsByUserId(userId) {
  if (!userId) return [];
  return await all(`SELECT DISTINCT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`, [userId]);
}

async function getAdminSubscriptions() {
  return await all(`
    SELECT DISTINCT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    INNER JOIN users u ON ps.user_id = u.id
    WHERE u.role = 'admin'
  `);
}

async function deleteSubscriptionByEndpoint(endpoint) {
  return await run(`DELETE FROM push_subscriptions WHERE endpoint = ?`, [endpoint]);
}

// Messages Helpers
async function saveMessage({ id, channelType, senderId, senderName, receiverId, content, contextData, timestamp }) {
  const contextStr = contextData ? (typeof contextData === 'string' ? contextData : JSON.stringify(contextData)) : null;
  const finalTs = timestamp ? (new Date(timestamp).toISOString()) : (new Date().toISOString());
  return await run(
    `INSERT OR IGNORE INTO messages (id, channel_type, sender_id, sender_name, receiver_id, content, context_data, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, channelType, senderId, senderName, receiverId || null, content, contextStr, finalTs]
  );
}

async function getMessages({ channelType, limit = 50, before = null, senderId = null, receiverId = null }) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
  const beforeClause = before ? 'AND timestamp < ?' : '';
  if (channelType === 'private') {
    const params = before ? [before, safeLimit] : [safeLimit];
    return await all(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE channel_type = 'private'
         ${beforeClause}
         ORDER BY timestamp DESC
         LIMIT ?
       ) ORDER BY timestamp ASC`,
      params
    );
  } else if (channelType === 'support') {
    if (senderId && senderId !== 'undefined' && senderId !== 'null' && String(senderId).trim() !== '') {
      const params = before ? [senderId, senderId, before, safeLimit] : [senderId, senderId, safeLimit];
      return await all(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE channel_type = 'support' AND (sender_id = ? OR receiver_id = ?)
           ${beforeClause}
           ORDER BY timestamp DESC
           LIMIT ?
         ) ORDER BY timestamp ASC`,
        params
      );
    }
    return [];
  }
  return [];
}

// Direct 1-to-1 Messages Helpers
async function getMessageById(messageId) {
  return await get(`SELECT * FROM messages WHERE id = ?`, [messageId]);
}

async function markSupportMessagesAsRead(senderId) {
  return await run(
    `UPDATE messages SET is_read = 1 WHERE channel_type = 'support' AND (sender_id = ? OR receiver_id = ?) AND is_read = 0`,
    [senderId, senderId]
  );
}

async function softDeleteMessage(messageId, scope = 'sender_only', deletedBy = 'unknown') {
  return await run(
    `UPDATE messages SET deleted_scope = ?, deleted_by = ?, deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [scope, deletedBy, messageId]
  );
}

async function hardDeleteMessage(messageId) {
  return await run(`DELETE FROM messages WHERE id = ?`, [messageId]);
}

async function editMessage(messageId, senderId, newContent) {
  const msg = await get('SELECT * FROM messages WHERE id = ?', [messageId]);
  if (!msg) throw new Error('Message non trouvé');
  if (msg.sender_id !== senderId) throw new Error('Seul l\'auteur peut modifier ce message');

  // 15-minute time window check (900,000 ms)
  const msgTime = new Date(msg.timestamp).getTime();
  const now = Date.now();
  if (now - msgTime > 15 * 60 * 1000) {
    throw new Error('Délai de modification dépassé (maximum 15 minutes)');
  }

  await run(
    `UPDATE messages SET content = ?, is_edited = 1, edited_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [newContent, messageId]
  );
  return await get('SELECT * FROM messages WHERE id = ?', [messageId]);
}

async function getDirectMessages(userA, userB, userRole = 'family', limit = 50, before = null) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
  const beforeClause = before ? 'AND timestamp < ?' : '';
  const baseParams = [userA, userB, userB, userA];
  if (userRole === 'admin') {
    // Admin sees all messages, including soft-deleted ones with audit flag
    const params = before ? [...baseParams, before, safeLimit] : [...baseParams, safeLimit];
    return await all(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE channel_type = 'private'
           AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
           AND (deleted_scope IS NULL OR deleted_scope != 'all')
           ${beforeClause}
         ORDER BY timestamp DESC
         LIMIT ?
       ) ORDER BY timestamp ASC`,
      params
    );
  } else {
    // Members see active messages + messages not deleted for current user
    const params = before ? [userA, userB, userB, userA, userA, userA, before, safeLimit] : [userA, userB, userB, userA, userA, userA, safeLimit];
    return await all(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE channel_type = 'private'
           AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
           AND (deleted_scope IS NULL OR (deleted_scope = 'sender_only' AND sender_id != ?) OR (deleted_scope = 'receiver_only' AND receiver_id != ?))
           ${beforeClause}
         ORDER BY timestamp DESC
         LIMIT ?
       ) ORDER BY timestamp ASC`,
      params
    );
  }
}

async function getUnreadCountsForUser(userId) {
  const rows = await all(
    `SELECT sender_id, COUNT(*) as unread_count
     FROM messages
     WHERE receiver_id = ? AND is_read = 0 AND (deleted_scope IS NULL OR deleted_scope != 'all')
     GROUP BY sender_id`,
    [userId]
  );
  const counts = {};
  rows.forEach(r => {
    counts[r.sender_id] = r.unread_count;
  });
  return counts;
}

async function markMessagesAsRead(receiverId, senderId) {
  return await run(
    `UPDATE messages SET is_read = 1 WHERE receiver_id = ? AND sender_id = ? AND is_read = 0`,
    [receiverId, senderId]
  );
}

async function addContact(userId, contactId) {
  if (!userId || !contactId || userId === contactId) return;
  await run(`INSERT OR IGNORE INTO user_contacts (user_id, contact_id) VALUES (?, ?)`, [userId, contactId]);
  await run(`INSERT OR IGNORE INTO user_contacts (user_id, contact_id) VALUES (?, ?)`, [contactId, userId]);
}

async function removeContact(userId, contactId) {
  await run(`DELETE FROM user_contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)`, [userId, contactId, contactId, userId]);
}

async function searchUsers(query, currentUserId) {
  const searchTerm = `%${query.toLowerCase().trim()}%`;
  return await all(
    `SELECT u.id, u.username, u.display_name, u.role,
            CASE WHEN uc.contact_id IS NOT NULL THEN 1 ELSE 0 END as is_contact
     FROM users u
     LEFT JOIN user_contacts uc ON (uc.user_id = ? AND uc.contact_id = u.id)
     WHERE u.id != ?
       AND (LOWER(u.username) LIKE ? OR LOWER(u.display_name) LIKE ?)
     ORDER BY is_contact DESC, u.display_name ASC
     LIMIT 20`,
    [currentUserId, currentUserId, searchTerm, searchTerm]
  );
}

async function areUsersContacts(userAId, userBId) {
  if (!userAId || !userBId || userAId === userBId) return false;
  const row = await get(
    `SELECT 1 FROM user_contacts WHERE user_id = ? AND contact_id = ?`,
    [userAId, userBId]
  );
  return Boolean(row);
}

async function getUserByExactUsername(username) {
  if (!username) return null;
  const clean = username.toLowerCase().trim().replace(/^@/, '');
  return await get(`SELECT id, username, display_name, role, created_at FROM users WHERE LOWER(username) = ?`, [clean]);
}

async function createContactRequest(senderId, receiverId) {
  if (!senderId || !receiverId || senderId === receiverId) {
    throw new Error('Action non valide');
  }
  const isAlready = await areUsersContacts(senderId, receiverId);
  if (isAlready) {
    throw new Error('Cet utilisateur est déjà dans vos contacts');
  }

  // Check if there is an inverse pending request
  const inverse = await get(
    `SELECT * FROM contact_requests WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'`,
    [receiverId, senderId]
  );
  if (inverse) {
    await addContact(senderId, receiverId);
    await run(`UPDATE contact_requests SET status = 'accepted' WHERE id = ?`, [inverse.id]);
    return { autoAccepted: true, requestId: inverse.id };
  }

  const reqId = 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  await run(
    `INSERT INTO contact_requests (id, sender_id, receiver_id, status, created_at)
     VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)
     ON CONFLICT(sender_id, receiver_id) DO UPDATE SET status = 'pending', created_at = CURRENT_TIMESTAMP`,
    [reqId, senderId, receiverId]
  );
  return { autoAccepted: false, requestId: reqId };
}

async function getPendingContactRequests(receiverId) {
  return await all(
    `SELECT cr.id as request_id, cr.created_at, u.id as sender_id, u.username, u.display_name, u.role
     FROM contact_requests cr
     JOIN users u ON cr.sender_id = u.id
     WHERE cr.receiver_id = ? AND cr.status = 'pending'
     ORDER BY cr.created_at DESC`,
    [receiverId]
  );
}

async function getContactRequestById(requestId) {
  return await get(`SELECT * FROM contact_requests WHERE id = ?`, [requestId]);
}

async function acceptContactRequest(requestId, receiverId) {
  const req = await get(
    `SELECT * FROM contact_requests WHERE id = ? AND receiver_id = ?`,
    [requestId, receiverId]
  );
  if (!req) throw new Error('Demande introuvable');
  if (req.status === 'accepted') return req;

  await addContact(req.sender_id, req.receiver_id);
  await run(`UPDATE contact_requests SET status = 'accepted' WHERE id = ?`, [requestId]);
  return req;
}

async function rejectContactRequest(requestId, receiverId) {
  const req = await get(
    `SELECT * FROM contact_requests WHERE id = ? AND receiver_id = ?`,
    [requestId, receiverId]
  );
  if (!req) throw new Error('Demande introuvable');
  await run(`UPDATE contact_requests SET status = 'rejected' WHERE id = ?`, [requestId]);
  return req;
}

async function getContactsForUser(currentUserId, currentUserRole = 'family') {
  const contacts = await all(
    `SELECT DISTINCT 
       u.id, u.username, u.display_name, u.role, u.created_at,
       m.content AS last_message,
       m.timestamp AS last_message_time,
       m.sender_id AS last_sender_id,
       m.is_read AS last_is_read
     FROM users u
     INNER JOIN user_contacts uc ON uc.contact_id = u.id
     LEFT JOIN messages m ON m.id = (
       SELECT id FROM messages
       WHERE channel_type = 'private'
         AND ((sender_id = ? AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = ?))
         AND (deleted_scope IS NULL OR deleted_scope != 'all')
       ORDER BY timestamp DESC
       LIMIT 1
     )
     WHERE uc.user_id = ? AND u.id != ?
     ORDER BY COALESCE(m.timestamp, u.created_at) DESC`,
    [currentUserId, currentUserId, currentUserId, currentUserId]
  );

  const unreadCounts = await getUnreadCountsForUser(currentUserId);
  return contacts.map(c => ({
    ...c,
    unreadCount: unreadCounts[c.id] || 0
  }));
}

async function getSupportConversations() {
  return await all(`
    WITH latest_support AS (
      SELECT 
        CASE 
          WHEN sender_id = 'admin' OR sender_id LIKE 'admin_%' THEN receiver_id 
          ELSE sender_id 
        END AS thread_id,
        MAX(CASE WHEN sender_id NOT LIKE 'admin%' AND sender_id != 'admin' THEN sender_name ELSE '' END) AS sender_name,
        MAX(CASE WHEN context_data IS NOT NULL AND context_data != '' THEN context_data END) AS context_data,
        MAX(timestamp) AS last_activity,
        COUNT(*) AS message_count,
        SUM(CASE WHEN (sender_id NOT LIKE 'admin%' AND sender_id != 'admin') AND (is_read = 0 OR is_read IS NULL) THEN 1 ELSE 0 END) AS unread_count
      FROM messages
      WHERE channel_type = 'support'
      GROUP BY 
        CASE 
          WHEN sender_id = 'admin' OR sender_id LIKE 'admin_%' THEN receiver_id 
          ELSE sender_id 
        END
    )
    SELECT 
      ls.thread_id AS sender_id,
      ls.sender_name,
      ls.context_data,
      ls.last_activity,
      ls.message_count,
      ls.unread_count,
      m.content AS last_message,
      m.timestamp AS last_message_at,
      m.sender_id AS last_sender_id,
      m.is_read AS last_is_read
    FROM latest_support ls
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages 
      WHERE channel_type = 'support' AND (sender_id = ls.thread_id OR receiver_id = ls.thread_id)
      ORDER BY timestamp DESC 
      LIMIT 1
    )
    ORDER BY ls.last_activity DESC
  `);
}

async function createSalon({ id, name, description, icon, created_by, memberIds = [] }) {
  await run(
    `INSERT INTO salons (id, name, description, icon, created_by) VALUES (?, ?, ?, ?, ?)`,
    [id, name, description || '', icon || '🛡️', created_by]
  );
  // Add creator as creator role
  await addSalonMember(id, created_by, 'creator');
  for (const mid of memberIds) {
    if (mid && mid !== created_by) {
      await addSalonMember(id, mid, 'member');
    }
  }
  return await getSalonById(id);
}

async function getSalonsForUser(userId) {
  return await all(
    `SELECT s.*, sm.role as my_role, sm.last_read_at,
       (SELECT COUNT(*) FROM salon_members WHERE salon_id = s.id) as member_count,
       (SELECT timestamp FROM messages WHERE channel_type = 'salon' AND receiver_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_activity,
       (SELECT content FROM messages WHERE channel_type = 'salon' AND receiver_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_message,
       (SELECT sender_id FROM messages WHERE channel_type = 'salon' AND receiver_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_sender_id,
       (SELECT sender_name FROM messages WHERE channel_type = 'salon' AND receiver_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_sender_name,
       (SELECT is_read FROM messages WHERE channel_type = 'salon' AND receiver_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_is_read,
       (SELECT COUNT(*) FROM messages 
        WHERE channel_type = 'salon' 
          AND receiver_id = s.id 
          AND sender_id != ? 
          AND (deleted_scope IS NULL OR deleted_scope != 'all')
          AND (sm.last_read_at IS NULL OR timestamp > sm.last_read_at)
       ) as unread_count
     FROM salons s
     JOIN salon_members sm ON s.id = sm.salon_id
     WHERE sm.user_id = ?
     ORDER BY COALESCE(last_activity, s.created_at) DESC`,
    [userId, userId]
  );
}

async function getSalonById(salonId) {
  return await get(`SELECT * FROM salons WHERE id = ?`, [salonId]);
}

async function getSalonMembers(salonId) {
  return await all(
    `SELECT u.id, u.username, u.display_name, u.role as global_role, sm.role as salon_role, COALESCE(sm.is_blocked, 0) as is_blocked, sm.joined_at
     FROM salon_members sm
     JOIN users u ON sm.user_id = u.id
     WHERE sm.salon_id = ?
     ORDER BY CASE WHEN sm.role = 'creator' THEN 0 ELSE 1 END, u.display_name ASC`,
    [salonId]
  );
}

async function isSalonAdmin(salonId, userId) {
  const user = await getUserById(userId);
  if (user && user.role === 'admin') return true;
  const member = await get(
    `SELECT role FROM salon_members WHERE salon_id = ? AND user_id = ?`,
    [salonId, userId]
  );
  return member && (member.role === 'creator' || member.role === 'admin');
}

async function addSalonMember(salonId, userId, role = 'member') {
  await run(
    `INSERT OR IGNORE INTO salon_members (salon_id, user_id, role, is_blocked) VALUES (?, ?, ?, 0)`,
    [salonId, userId, role]
  );
}

async function removeSalonMember(salonId, userId) {
  await run(
    `DELETE FROM salon_members WHERE salon_id = ? AND user_id = ?`,
    [salonId, userId]
  );
}

async function blockSalonMember(salonId, userId, isBlocked = 1) {
  await run(
    `UPDATE salon_members SET is_blocked = ? WHERE salon_id = ? AND user_id = ?`,
    [isBlocked ? 1 : 0, salonId, userId]
  );
}

async function isSalonMemberBlocked(salonId, userId) {
  const row = await get(
    `SELECT is_blocked, role FROM salon_members WHERE salon_id = ? AND user_id = ?`,
    [salonId, userId]
  );
  if (!row) return false;
  return Boolean(row.is_blocked === 1 || row.role === 'blocked');
}

async function updateSalonInfo(salonId, { name, description, icon }) {
  await run(
    `UPDATE salons SET name = ?, description = ?, icon = ? WHERE id = ?`,
    [name, description, icon || '🛡️', salonId]
  );
  return await getSalonById(salonId);
}

async function deleteSalon(salonId) {
  await run(`DELETE FROM salon_message_reads WHERE salon_id = ?`, [salonId]);
  await run(`DELETE FROM messages WHERE channel_type = 'salon' AND receiver_id = ?`, [salonId]);
  await run(`DELETE FROM salon_members WHERE salon_id = ?`, [salonId]);
  await run(`DELETE FROM salons WHERE id = ?`, [salonId]);
}

async function markSalonMessagesAsRead(salonId, userId) {
  const now = new Date().toISOString();
  await run(
    `UPDATE salon_members SET last_read_at = ? WHERE salon_id = ? AND user_id = ?`,
    [now, salonId, userId]
  );
  await run(
    `INSERT OR IGNORE INTO salon_message_reads (salon_id, message_id, user_id, read_at)
     SELECT receiver_id, id, ?, ?
     FROM messages
     WHERE channel_type = 'salon' AND receiver_id = ? AND sender_id != ? AND (deleted_scope IS NULL OR deleted_scope != 'all')`,
    [userId, now, salonId, userId]
  );
}

async function markSalonMessageReadByMembers(salonId, messageId, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  const now = new Date().toISOString();
  for (const uid of userIds) {
    await run(
      `INSERT OR IGNORE INTO salon_message_reads (salon_id, message_id, user_id, read_at) VALUES (?, ?, ?, ?)`,
      [salonId, messageId, uid, now]
    );
    await run(
      `UPDATE salon_members SET last_read_at = ? WHERE salon_id = ? AND user_id = ?`,
      [now, salonId, uid]
    );
  }
}

async function getSalonMessages(salonId, limit = 50, before = null) {
  const safeLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 100));
  const beforeClause = before ? 'AND m.timestamp < ?' : '';
  const params = before ? [salonId, before, safeLimit] : [salonId, safeLimit];
  return await all(
    `SELECT * FROM (
       SELECT m.*,
         CASE WHEN (SELECT COUNT(*) FROM salon_message_reads smr WHERE smr.message_id = m.id) > 0 THEN 1 ELSE 0 END as is_read,
         (SELECT COUNT(*) FROM salon_message_reads smr WHERE smr.message_id = m.id) as read_count
       FROM messages m
       WHERE m.channel_type = 'salon' AND m.receiver_id = ? AND (m.deleted_scope IS NULL OR m.deleted_scope != 'all')
       ${beforeClause}
       ORDER BY m.timestamp DESC LIMIT ?
     ) ORDER BY timestamp ASC`,
    params
  );
}

// Collaborative Salon Helpers: Polls, Pinned Messages & Salon Files
async function createPoll({ id, salonId, creatorId, question, options }) {
  const optionsJson = JSON.stringify(options);
  await run(
    `INSERT INTO polls (id, salon_id, creator_id, question, options) VALUES (?, ?, ?, ?, ?)`,
    [id, salonId, creatorId, question, optionsJson]
  );
  return await getPollById(id);
}

async function getPollById(pollId) {
  const poll = await get(`SELECT * FROM polls WHERE id = ?`, [pollId]);
  if (!poll) return null;
  const votes = await all(`SELECT user_id, option_index FROM poll_votes WHERE poll_id = ?`, [pollId]);
  try {
    poll.options = JSON.parse(poll.options || '[]');
  } catch (e) {
    poll.options = [];
  }
  poll.votes = votes || [];
  return poll;
}

async function votePoll(pollId, userId, optionIndex) {
  await run(
    `INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES (?, ?, ?)
     ON CONFLICT(poll_id, user_id) DO UPDATE SET option_index = excluded.option_index`,
    [pollId, userId, parseInt(optionIndex, 10)]
  );
  return await getPollById(pollId);
}

async function setSalonPinnedMessage(salonId, messageId) {
  return setUniversalPinnedMessage('salon', salonId, messageId);
}

async function setUniversalPinnedMessage(channelType, targetId, messageId, action = 'pin') {
  if (action === 'unpin') {
    if (messageId) {
      await run(`DELETE FROM pinned_messages_v2 WHERE channel_type = ? AND target_id = ? AND message_id = ?`, [channelType, targetId, messageId]);
    } else {
      await run(`DELETE FROM pinned_messages_v2 WHERE channel_type = ? AND target_id = ?`, [channelType, targetId]);
    }
  } else if (messageId) {
    // Check existing count for this conversation
    const existing = await all(
      `SELECT id, message_id FROM pinned_messages_v2 WHERE channel_type = ? AND target_id = ? ORDER BY updated_at ASC`,
      [channelType, targetId]
    );

    const isAlreadyPinned = existing.some(row => row.message_id === messageId);
    if (!isAlreadyPinned) {
      // Limit to 3 pinned messages max: if 3 exist, remove oldest (FIFO)
      if (existing.length >= 3) {
        const oldestId = existing[0].id;
        await run(`DELETE FROM pinned_messages_v2 WHERE id = ?`, [oldestId]);
      }
      await run(
        `INSERT INTO pinned_messages_v2 (channel_type, target_id, message_id, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [channelType, targetId, messageId]
      );
    } else {
      await run(
        `UPDATE pinned_messages_v2 SET updated_at = CURRENT_TIMESTAMP WHERE channel_type = ? AND target_id = ? AND message_id = ?`,
        [channelType, targetId, messageId]
      );
    }
  }

  return await getUniversalPinnedMessages(channelType, targetId);
}

async function getUniversalPinnedMessages(channelType, targetId) {
  const rows = await all(
    `SELECT pm.message_id, pm.updated_at, m.*
     FROM pinned_messages_v2 pm
     JOIN messages m ON pm.message_id = m.id
     WHERE pm.channel_type = ? AND pm.target_id = ?
     ORDER BY pm.updated_at DESC
     LIMIT 3`,
    [channelType, targetId]
  );
  return rows || [];
}

async function getSalonMediaFiles(salonId) {
  const msgs = await all(
    `SELECT id, sender_id, sender_name, content, timestamp
     FROM messages
     WHERE channel_type = 'salon' 
       AND receiver_id = ? 
       AND (deleted_scope IS NULL OR deleted_scope != 'all')
     ORDER BY timestamp DESC`,
    [salonId]
  );

  const files = [];
  for (const m of msgs) {
    let parsed = null;
    if (typeof m.content === 'object' && m.content !== null) {
      parsed = m.content;
    } else if (typeof m.content === 'string') {
      try {
        parsed = JSON.parse(m.content);
      } catch (e) {}
    }

    if (parsed && (parsed.url || parsed.fileUrl)) {
      files.push({
        id: m.id,
        sender_id: m.sender_id,
        sender_name: m.sender_name,
        content: parsed.text || parsed.fileName || m.content,
        file_url: parsed.url || parsed.fileUrl,
        file_name: parsed.fileName || parsed.name || 'Fichier',
        file_size: parsed.fileSize || parsed.size || null,
        file_type: parsed.fileType || parsed.type || 'file',
        media_type: parsed.type || 'file',
        timestamp: m.timestamp
      });
    }
  }
  return files;
}

// ----------------------------------------------------
// SuperAdmin Control Functions
// ----------------------------------------------------
async function banUser(userId, banState = 1) {
  await run(`UPDATE users SET is_banned = ? WHERE id = ?`, [banState ? 1 : 0, userId]);
  return { success: true, userId, is_banned: banState ? 1 : 0 };
}

async function getAllUsersForAdmin() {
  return await all(`
    SELECT id, username, display_name, role, COALESCE(is_banned, 0) as is_banned, created_at
    FROM users
    ORDER BY created_at DESC
  `);
}

async function getAdminMetrics() {
  const userCount = await get(`SELECT COUNT(*) as total FROM users`);
  const salonCount = await get(`SELECT COUNT(*) as total FROM salons`);
  const msgCount = await get(`SELECT COUNT(*) as total FROM messages`);
  const todayMsgCount = await get(`SELECT COUNT(*) as total FROM messages WHERE datetime(timestamp) >= datetime('now', 'start of day')`);
  return {
    total_users: userCount ? userCount.total : 0,
    total_salons: salonCount ? salonCount.total : 0,
    total_messages: msgCount ? msgCount.total : 0,
    today_messages: todayMsgCount ? todayMsgCount.total : 0
  };
}

async function nukeUser(userId) {
  const msgs = await all(`
    SELECT content, context_data FROM messages 
    WHERE sender_id = ? OR receiver_id = ?
  `, [userId, userId]);
  
  const filesToUnlink = [];
  msgs.forEach(m => {
    if (m.content && m.content.includes('/uploads/')) {
      const matches = m.content.match(/\/uploads\/[a-zA-Z0-9_\-.]+/g);
      if (matches) filesToUnlink.push(...matches);
    }
    if (m.context_data && m.context_data.includes('/uploads/')) {
      const matches = m.context_data.match(/\/uploads\/[a-zA-Z0-9_\-.]+/g);
      if (matches) filesToUnlink.push(...matches);
    }
  });

  await run(`DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?`, [userId, userId]);
  await run(`DELETE FROM salon_members WHERE user_id = ?`, [userId]);
  await run(`DELETE FROM contact_requests WHERE sender_id = ? OR receiver_id = ?`, [userId, userId]);
  await run(`DELETE FROM users WHERE id = ?`, [userId]);

  return { success: true, userId, filesToUnlink };
}

module.exports = {
  db,
  getUserCount,
  createUser,
  getUserByUsername,
  getUserById,
  getAllUsers,
  updateUser,
  deleteUser,
  getContactsForUser,
  addContact,
  removeContact,
  searchUsers,
  getUnreadCountsForUser,
  markMessagesAsRead,
  saveSubscription,
  getSubscriptionsByUserId,
  getAdminSubscriptions,
  deleteSubscriptionByEndpoint,
  saveMessage,
  getMessages,
  getDirectMessages,
  getMessageById,
  softDeleteMessage,
  hardDeleteMessage,
  editMessage,
  getSupportConversations,
  markSupportMessagesAsRead,
  // Salons exports
  createSalon,
  getSalonsForUser,
  getSalonById,
  getSalonMembers,
  isSalonAdmin,
  addSalonMember,
  removeSalonMember,
  blockSalonMember,
  isSalonMemberBlocked,
  updateSalonInfo,
  deleteSalon,
  markSalonMessagesAsRead,
  markSalonMessageReadByMembers,
  getSalonMessages,
  // Collaborative Salon Exports
  createPoll,
  getPollById,
  votePoll,
  setSalonPinnedMessage,
  setUniversalPinnedMessage,
  getUniversalPinnedMessages,
  getSalonMediaFiles,
  // Contact Requests exports
  areUsersContacts,
  getUserByExactUsername,
  createContactRequest,
  getPendingContactRequests,
  getContactRequestById,
  acceptContactRequest,
  rejectContactRequest,
  // SuperAdmin exports
  banUser,
  getAllUsersForAdmin,
  getAdminMetrics,
  nukeUser,
  initTables
};
