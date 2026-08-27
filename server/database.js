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
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(salon_id, user_id)
    )
  `);
  try {
    await run(`ALTER TABLE salon_members ADD COLUMN is_blocked INTEGER DEFAULT 0`);
  } catch (e) {}
  await run(`CREATE INDEX IF NOT EXISTS idx_salon_members_salon ON salon_members(salon_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_salon_members_user ON salon_members(user_id)`);

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
  return await get(`SELECT id, username, display_name, role, created_at FROM users WHERE id = ?`, [id]);
}

async function getAllUsers() {
  return await all(`SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at ASC`);
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
  return await all(`SELECT DISTINCT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? OR user_id = 'admin' OR user_id = 'guest'`, [userId]);
}

async function getAdminSubscriptions() {
  return await all(`
    SELECT DISTINCT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    LEFT JOIN users u ON ps.user_id = u.id
    WHERE u.role = 'admin' OR ps.user_id = 'admin' OR ps.user_id = 'guest'
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
    `INSERT INTO messages (id, channel_type, sender_id, sender_name, receiver_id, content, context_data, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, channelType, senderId, senderName, receiverId || null, content, contextStr, finalTs]
  );
}

async function getMessages({ channelType, limit = 300, senderId = null, receiverId = null }) {
  if (channelType === 'private') {
    return await all(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE channel_type = 'private'
         ORDER BY timestamp DESC
         LIMIT ?
       ) ORDER BY timestamp ASC`,
      [limit]
    );
  } else if (channelType === 'support') {
    if (senderId && senderId !== 'undefined' && senderId !== 'null' && String(senderId).trim() !== '') {
      return await all(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE channel_type = 'support' AND (sender_id = ? OR receiver_id = ?)
           ORDER BY timestamp DESC
           LIMIT ?
         ) ORDER BY timestamp ASC`,
        [senderId, senderId, limit]
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
    `UPDATE messages SET is_read = 1 WHERE channel_type = 'support' AND sender_id = ?`,
    [senderId]
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

async function getDirectMessages(userA, userB, userRole = 'family', limit = 300) {
  if (userRole === 'admin') {
    // Admin sees all messages, including soft-deleted ones with audit flag
    return await all(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE channel_type = 'private'
           AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
           AND (deleted_scope IS NULL OR deleted_scope != 'all')
         ORDER BY timestamp DESC
         LIMIT ?
       ) ORDER BY timestamp ASC`,
      [userA, userB, userB, userA, limit]
    );
  } else {
    // Members see active messages + messages not deleted for current user
    return await all(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE channel_type = 'private'
           AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
           AND (deleted_scope IS NULL OR (deleted_scope = 'sender_only' AND sender_id != ?) OR (deleted_scope = 'receiver_only' AND receiver_id != ?))
         ORDER BY timestamp DESC
         LIMIT ?
       ) ORDER BY timestamp ASC`,
      [userA, userB, userB, userA, userA, userA, limit]
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

async function getContactsForUser(currentUserId, currentUserRole = 'family') {
  const contacts = await all(
    `SELECT DISTINCT u.id, u.username, u.display_name, u.role, u.created_at
     FROM users u
     INNER JOIN user_contacts uc ON uc.contact_id = u.id
     WHERE uc.user_id = ? AND u.id != ?
     ORDER BY u.display_name ASC`,
    [currentUserId, currentUserId]
  );

  const unreadCounts = await getUnreadCountsForUser(currentUserId);
  return contacts.map(c => ({
    ...c,
    unreadCount: unreadCounts[c.id] || 0
  }));
}

async function getSupportConversations() {
  return await all(`
    SELECT 
      CASE 
        WHEN sender_id = 'admin' OR sender_id LIKE 'admin_%' THEN receiver_id 
        ELSE sender_id 
      END AS sender_id,
      MAX(CASE WHEN sender_id NOT LIKE 'admin%' AND sender_id != 'admin' THEN sender_name ELSE '' END) AS sender_name,
      MAX(CASE WHEN context_data IS NOT NULL AND context_data != '' THEN context_data END) AS context_data,
      MAX(timestamp) AS last_activity,
      COUNT(*) AS message_count
    FROM messages
    WHERE channel_type = 'support'
    GROUP BY 
      CASE 
        WHEN sender_id = 'admin' OR sender_id LIKE 'admin_%' THEN receiver_id 
        ELSE sender_id 
      END
    ORDER BY last_activity DESC
  `);
}

async function createSalon({ id, name, description, icon, created_by, memberIds = [] }) {
  await run(
    `INSERT INTO salons (id, name, description, icon, created_by) VALUES (?, ?, ?, ?, ?)`,
    [id, name, description || '', icon || '🛡️', created_by]
  );
  // Add creator as creator role
  await run(
    `INSERT OR IGNORE INTO salon_members (salon_id, user_id, role) VALUES (?, ?, 'creator')`,
    [id, created_by]
  );

  // Add initial members
  for (const uid of memberIds) {
    if (uid !== created_by) {
      await run(
        `INSERT OR IGNORE INTO salon_members (salon_id, user_id, role) VALUES (?, ?, 'member')`,
        [id, uid]
      );
    }
  }
  return await getSalonById(id);
}

async function getSalonsForUser(userId) {
  return await all(
    `SELECT s.*, sm.role as my_role,
       (SELECT COUNT(*) FROM salon_members WHERE salon_id = s.id) as member_count,
       (SELECT timestamp FROM messages WHERE channel_type = 'salon' AND receiver_id = s.id ORDER BY timestamp DESC LIMIT 1) as last_activity
     FROM salons s
     JOIN salon_members sm ON s.id = sm.salon_id
     WHERE sm.user_id = ?
     ORDER BY COALESCE(last_activity, s.created_at) DESC`,
    [userId]
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
  await run(`DELETE FROM messages WHERE channel_type = 'salon' AND receiver_id = ?`, [salonId]);
  await run(`DELETE FROM salon_members WHERE salon_id = ?`, [salonId]);
  await run(`DELETE FROM salons WHERE id = ?`, [salonId]);
}

async function getSalonMessages(salonId, limit = 100) {
  return await all(
    `SELECT * FROM messages 
     WHERE channel_type = 'salon' AND receiver_id = ? AND (deleted_scope IS NULL OR deleted_scope != 'all')
     ORDER BY timestamp ASC LIMIT ?`,
    [salonId, limit]
  );
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
  getSalonMessages
};
