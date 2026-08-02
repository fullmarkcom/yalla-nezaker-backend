const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS app_data (
    user_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    send_at TEXT NOT NULL,
    repeat TEXT NOT NULL DEFAULT 'once',
    category TEXT DEFAULT 'عام',
    sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_send_at ON reminders(send_at, sent);
`);

function createUser(email, passwordHash) {
  const info = db.prepare(`INSERT INTO users (email, password_hash) VALUES (?, ?)`).run(email, passwordHash);
  db.prepare(`INSERT INTO app_data (user_id, data) VALUES (?, '{}')`).run(info.lastInsertRowid);
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(info.lastInsertRowid);
}

function getUserByEmail(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
}

function getUserById(id) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
}

function getAppData(userId) {
  const row = db.prepare(`SELECT data, version, updated_at FROM app_data WHERE user_id = ?`).get(userId);
  return row
    ? { data: JSON.parse(row.data), version: row.version, updatedAt: row.updated_at }
    : { data: {}, version: 0, updatedAt: null };
}

function setAppData(userId, dataObj, expectedVersion) {
  const current = db.prepare(`SELECT version FROM app_data WHERE user_id = ?`).get(userId);
  const currentVersion = current ? current.version : 0;

  if (typeof expectedVersion === 'number' && expectedVersion !== currentVersion) {
    return { conflict: true, server: getAppData(userId) };
  }

  const json = JSON.stringify(dataObj);
  db.prepare(`
    INSERT INTO app_data (user_id, data, version, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, version = version + 1, updated_at = datetime('now')
  `).run(userId, json);
  return { conflict: false, server: getAppData(userId) };
}

function createPasswordReset(userId, tokenHash, expiresAt) {
  db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`)
    .run(userId, tokenHash, expiresAt);
}

function getValidPasswordReset(tokenHash) {
  return db.prepare(`
    SELECT * FROM password_resets
    WHERE token_hash = ? AND used = 0 AND expires_at > datetime('now')
  `).get(tokenHash);
}

function markPasswordResetUsed(id) {
  db.prepare(`UPDATE password_resets SET used = 1 WHERE id = ?`).run(id);
}

function updateUserPassword(userId, passwordHash) {
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, userId);
}

function saveSubscription(userId, sub) {
  db.prepare(`
    INSERT INTO subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (@user_id, @endpoint, @p256dh, @auth)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = @p256dh, auth = @auth, user_id = @user_id
  `).run({ user_id: userId, ...sub });
  return db.prepare(`SELECT * FROM subscriptions WHERE endpoint = ?`).get(sub.endpoint);
}

function deleteSubscription(endpoint) {
  return db.prepare(`DELETE FROM subscriptions WHERE endpoint = ?`).run(endpoint);
}

function deleteSubscriptionById(id) {
  return db.prepare(`DELETE FROM subscriptions WHERE id = ?`).run(id);
}

function getSubscriptionsByUser(userId) {
  return db.prepare(`SELECT * FROM subscriptions WHERE user_id = ?`).all(userId);
}

function addReminder(userId, { title, body, sendAt, repeat, category }) {
  const info = db.prepare(`
    INSERT INTO reminders (user_id, title, body, send_at, repeat, category)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, title, body || '', sendAt, repeat || 'once', category || 'عام');
  return db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(info.lastInsertRowid);
}

function listRemindersByUser(userId) {
  return db.prepare(`SELECT * FROM reminders WHERE user_id = ? ORDER BY send_at ASC`).all(userId);
}

function deleteReminder(id, userId) {
  return db.prepare(`DELETE FROM reminders WHERE id = ? AND user_id = ?`).run(id, userId);
}

function getDueReminders(nowIso) {
  const reminders = db.prepare(`
    SELECT * FROM reminders WHERE sent = 0 AND send_at <= ?
  `).all(nowIso);

  return reminders.map((r) => ({
    ...r,
    subscriptions: getSubscriptionsByUser(r.user_id),
  }));
}

function markSent(id) {
  db.prepare(`UPDATE reminders SET sent = 1 WHERE id = ?`).run(id);
}

function rescheduleRecurring(id, nextSendAt) {
  db.prepare(`UPDATE reminders SET send_at = ?, sent = 0 WHERE id = ?`).run(nextSendAt, id);
}

module.exports = {
  createUser, getUserByEmail, getUserById, getAppData, setAppData,
  saveSubscription, deleteSubscription, deleteSubscriptionById, getSubscriptionsByUser,
  addReminder, listRemindersByUser, deleteReminder, getDueReminders, markSent, rescheduleRecurring,
  createPasswordReset, getValidPasswordReset, markPasswordResetUsed, updateUserPassword,
};
