const winston = require('winston');
const path = require('path');
const crypto = require('crypto');

// Validate required environment variables
if (!process.env.LOG_LEVEL) {
  throw new Error('Missing required environment variable: LOG_LEVEL');
}

// Determine if file logging should be enabled
// In Kubernetes, we only use console logging (logs are collected by Loki)
const isKubernetes = !!process.env.KUBERNETES_SERVICE_HOST;
const shouldUseFileLogging = !isKubernetes && process.env.FILE_LOGGING !== 'false';

const transports = [];

// Add file transports only in non-Kubernetes environments
if (shouldUseFileLogging) {
  transports.push(
    new winston.transports.File({
      filename: path.join('logs', 'error.log'),
      level: 'error'
    }),
    new winston.transports.File({
      filename: path.join('logs', 'combined.log')
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'openprime-backend' },
  transports,
});

// Add console logging based on CONSOLE_LOGGING env var or if not in production
// This ensures logs are visible in Kubernetes pods via kubectl logs
const shouldLogToConsole = process.env.CONSOLE_LOGGING !== 'false' && 
  (process.env.NODE_ENV !== 'production' || process.env.CONSOLE_LOGGING === 'true');

if (shouldLogToConsole) {
  const consoleFormat = process.env.NODE_ENV === 'production' 
    ? winston.format.combine(winston.format.timestamp(), winston.format.simple())
    : winston.format.combine(winston.format.colorize(), winston.format.simple());
    
  logger.add(new winston.transports.Console({ format: consoleFormat }));
}

// Stream for Morgan (with request ID support)
logger.stream = {
  write: (message, req) => {
    const meta = req?.requestId ? { requestId: req.requestId } : {};
    logger.info(message.trim(), meta);
  }
};

/**
 * Generate a unique request ID
 * @returns {string} 16-character hex string
 */
function generateRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Create a child logger with request context
 * @param {string} requestId - Request correlation ID
 * @returns {winston.Logger} Child logger with requestId in metadata
 */
function createRequestLogger(requestId) {
  return logger.child({ requestId });
}

module.exports = { logger, generateRequestId, createRequestLogger };
