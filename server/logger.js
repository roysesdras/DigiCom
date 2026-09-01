const fs = require('fs');
const path = require('path');

const logDir = path.join(__dirname, 'data');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFile = path.join(logDir, 'digicom.log');
const maxLogSizeBytes = 10 * 1024 * 1024; // 10 MB

const memoryLogs = [];
const maxMemoryLogs = 300;

function formatTimestamp() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').replace('Z', '');
}

function rotateLogsIfNeeded() {
  try {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > maxLogSizeBytes) {
        const backupFile = path.join(logDir, 'digicom.log.1');
        if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile);
        fs.renameSync(logFile, backupFile);
      }
    }
  } catch (e) {}
}

function writeLog(level, tag, message, meta = null) {
  const time = formatTimestamp();
  const metaStr = meta ? ' ' + (typeof meta === 'object' ? JSON.stringify(meta) : String(meta)) : '';
  const logLine = `[${time}] [${level.toUpperCase()}] [${tag}] ${message}${metaStr}\n`;

  // Push to memory buffer for instant admin retrieval
  memoryLogs.push(logLine.trim());
  if (memoryLogs.length > maxMemoryLogs) {
    memoryLogs.shift();
  }

  // Console output
  if (level === 'error') {
    console.error(logLine.trim());
  } else if (level === 'warn') {
    console.warn(logLine.trim());
  } else {
    console.log(logLine.trim());
  }

  // File write
  try {
    rotateLogsIfNeeded();
    fs.appendFileSync(logFile, logLine, 'utf8');
  } catch (err) {
    console.error('[-] Failed to write to log file:', err.message);
  }
}

const logger = {
  info: (tag, message, meta) => writeLog('info', tag, message, meta),
  warn: (tag, message, meta) => writeLog('warn', tag, message, meta),
  error: (tag, message, meta) => writeLog('error', tag, message, meta),
  debug: (tag, message, meta) => writeLog('debug', tag, message, meta),
  getRecentLogs: (limit = 100) => {
    return memoryLogs.slice(-limit);
  },
  getLogFilePath: () => logFile,
  readLogFile: (maxLines = 200) => {
    try {
      if (!fs.existsSync(logFile)) return [];
      const content = fs.readFileSync(logFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      return lines.slice(-maxLines);
    } catch (e) {
      return [`[ERROR] Could not read log file: ${e.message}`];
    }
  }
};

module.exports = logger;
