const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'openprime-backend' },
  transports: [
    // Write all logs with level 'error' and below to error.log
    new winston.transports.File({ 
      filename: path.join('logs', 'error.log'), 
      level: 'error' 
    }),
    // Write all logs with level 'info' and below to combined.log
    new winston.transports.File({ 
      filename: path.join('logs', 'combined.log') 
    }),
  ],
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

// Stream for Morgan
logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

module.exports = { logger };
