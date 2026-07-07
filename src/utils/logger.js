const winston = require("winston");
const path = require("path");
const crypto = require("crypto");
const { redact, maskUrlAuth, isSensitiveKey } = require("./redact");
const { getRequestId } = require("./requestContext");

// Validate required environment variables
if (!process.env.LOG_LEVEL) {
  throw new Error("Missing required environment variable: LOG_LEVEL");
}

// Fail closed on verbose logging in production. Levels below "info" (debug,
// verbose, silly) risk dumping request bodies and generated configs; redaction
// scrubs known secrets, but banning these levels keeps them out of prod entirely.
const VERBOSE_LEVELS = new Set(["debug", "verbose", "silly"]);
if (process.env.NODE_ENV === "production" && VERBOSE_LEVELS.has(process.env.LOG_LEVEL)) {
  throw new Error(
    `LOG_LEVEL=${process.env.LOG_LEVEL} is not allowed in production (risks logging sensitive data). Use info, warn, or error.`,
  );
}

// Winston format that redacts secrets from every log record before serialization.
// Applied to all transports (file + console) since transport-level formats do not
// inherit the logger format. Winston's own fields are left untouched.
const RESERVED_FIELDS = new Set(["level", "message", "timestamp", "service", "stack"]);
const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (RESERVED_FIELDS.has(key)) continue;
    info[key] = isSensitiveKey(key) ? "[REDACTED]" : redact(info[key]);
  }
  info.message = maskUrlAuth(info.message);
  return info;
});

// Stamp the current request's correlation id onto records that don't already carry
// one (i.e. module-level logger calls in services), so all logs for a request —
// and the Injecto/StateCraft logs it triggers — share one requestId.
const requestIdFormat = winston.format((info) => {
  if (!info.requestId) {
    const requestId = getRequestId();
    if (requestId) info.requestId = requestId;
  }
  return info;
});

// Determine if file logging should be enabled
// In Kubernetes, we only use console logging (logs are collected by Loki)
const isKubernetes = !!process.env.KUBERNETES_SERVICE_HOST;
const shouldUseFileLogging = !isKubernetes && process.env.FILE_LOGGING !== "false";

const transports = [];

// Add file transports only in non-Kubernetes environments
if (shouldUseFileLogging) {
  transports.push(
    new winston.transports.File({
      filename: path.join("logs", "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join("logs", "combined.log"),
    }),
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    requestIdFormat(),
    redactFormat(),
    winston.format.json(),
  ),
  defaultMeta: { service: "openprime-backend" },
  transports,
});

// Add console logging based on CONSOLE_LOGGING env var or if not in production
// This ensures logs are visible in Kubernetes pods via kubectl logs
const shouldLogToConsole =
  process.env.CONSOLE_LOGGING !== "false" &&
  (process.env.NODE_ENV !== "production" || process.env.CONSOLE_LOGGING === "true");

if (shouldLogToConsole) {
  // Console emits the same structured JSON as the file transports and the Python
  // services — one common format everywhere (local and prod) so Loki, and any
  // developer, sees every service the same way. Pipe through `jq` for pretty local
  // reading if desired.
  const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    requestIdFormat(),
    redactFormat(),
    winston.format.json(),
  );

  logger.add(new winston.transports.Console({ format: consoleFormat }));
}

/**
 * Generate a unique request ID
 * @returns {string} 16-character hex string
 */
function generateRequestId() {
  return crypto.randomBytes(8).toString("hex");
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
