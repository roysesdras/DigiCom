/**
 * Automated Encrypted Database Backup Script for Digicom
 * 
 * Performs an online snapshot of digicom.db, encrypts it using AES-256-GCM,
 * and transfers the encrypted backup file via secure SSH to the dedicated
 * storage VPS (162.35.166.27) in /root/storage_digicom/backups/.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const dbPath = path.join(__dirname, 'data', 'digicom.db');
const backupDir = path.join(__dirname, 'data', 'backups');
const remoteHost = process.env.STORAGE_HOST || '162.35.166.27';
const remoteUser = process.env.STORAGE_USER || 'root';
const remoteBackupDir = process.env.STORAGE_BACKUP_PATH || '/root/storage_digicom/backups';
const sshKeyPath = process.env.STORAGE_SSH_KEY || '/root/.ssh/id_ed25519_digicom';
const secretKeyStr = process.env.BACKUP_ENCRYPTION_KEY || process.env.JWT_SECRET || (() => {
  const localKeyFile = path.join(__dirname, 'data', 'backup.key');
  if (fs.existsSync(localKeyFile)) return fs.readFileSync(localKeyFile, 'utf8').trim();
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(localKeyFile, generated, { mode: 0o600 });
  return generated;
})();

// Derive 32-byte key for AES-256 from secret
const encryptionKey = crypto.createHash('sha256').update(secretKeyStr).digest();

if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir, { recursive: true });
}

function runRsync(args) {
  return new Promise((resolve, reject) => {
    execFile('rsync', args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

const { db: activeDb } = require('./database');
const sqlite3 = require('sqlite3').verbose();

function createDatabaseSnapshot(sourcePath, targetPath) {
  return new Promise((resolve, reject) => {
    // 1. Deleguer a la methode native db.backup() SQLite si l'instance active est disponible
    if (activeDb && typeof activeDb.backup === 'function') {
      try {
        activeDb.backup(targetPath, (err) => {
          if (!err) {
            console.log('[+] Native db.backup() snapshot completed successfully.');
            return resolve();
          }
          console.warn('[-] db.backup() notice, trying VACUUM INTO fallback:', err.message);
          fallbackVacuum(sourcePath, targetPath).then(resolve).catch(reject);
        });
        return;
      } catch (e) {
        console.warn('[-] Native db.backup() exception, trying VACUUM INTO fallback:', e.message);
      }
    }
    fallbackVacuum(sourcePath, targetPath).then(resolve).catch(reject);
  });
}

function fallbackVacuum(sourcePath, targetPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(sourcePath, sqlite3.OPEN_READWRITE, (err) => {
      if (err) return reject(err);
      const safePath = targetPath.replace(/'/g, "''");
      db.run(`VACUUM INTO '${safePath}'`, (vacuumErr) => {
        db.close(() => {
          if (vacuumErr) return reject(vacuumErr);
          resolve();
        });
      });
    });
  });
}

async function performBackup() {
  console.log('[+] Starting automated encrypted database backup...');
  
  if (!fs.existsSync(dbPath)) {
    console.error('[-] Error: Database file not found at', dbPath);
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tempSnapshot = path.join(backupDir, `snapshot_${timestamp}.db`);
  const encryptedBackup = path.join(backupDir, `digicom_backup_${timestamp}.db.enc`);

  try {
    // 1. Create non-blocking atomic database snapshot using native db.backup()
    try {
      await createDatabaseSnapshot(dbPath, tempSnapshot);
      console.log('[+] Non-blocking SQLite snapshot created:', tempSnapshot);
    } catch (vErr) {
      console.warn('[-] Snapshot fallback to copyFileSync:', vErr.message);
      fs.copyFileSync(dbPath, tempSnapshot);
    }

    // 2. Encrypt database snapshot using AES-256-GCM
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    
    const input = fs.readFileSync(tempSnapshot);
    const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Pack IV (16B) + AuthTag (16B) + Encrypted Payload
    const finalBuffer = Buffer.concat([iv, authTag, encrypted]);
    fs.writeFileSync(encryptedBackup, finalBuffer);
    console.log('[+] Backup encrypted with AES-256-GCM:', encryptedBackup);

    // 3. Transfer encrypted backup file to remote storage VPS
    console.log('[+] Transferring backup to remote storage VPS...');
    await runRsync([
      '-avz',
      '-e', `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no`,
      encryptedBackup,
      `${remoteUser}@${remoteHost}:${remoteBackupDir}/`
    ]);
    console.log('[+] Backup successfully transferred to remote storage VPS:', `${remoteHost}:${remoteBackupDir}/`);

    // 4. Cleanup local temporary backup files
    if (fs.existsSync(tempSnapshot)) fs.unlinkSync(tempSnapshot);
    if (fs.existsSync(encryptedBackup)) fs.unlinkSync(encryptedBackup);
    console.log('[+] Local temporary backup files cleaned up.');

  } catch (err) {
    console.error('[-] Backup process failed:', err.message);
    if (fs.existsSync(tempSnapshot)) fs.unlinkSync(tempSnapshot);
    if (fs.existsSync(encryptedBackup)) fs.unlinkSync(encryptedBackup);
  }
}

if (require.main === module) {
  performBackup();
}

module.exports = { performBackup };
