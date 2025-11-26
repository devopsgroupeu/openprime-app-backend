const { generateRequestId, createRequestLogger } = require('../utils/logger');

/**
 * Middleware to add request correlation ID and scoped logger to each request.
 * - Generates unique requestId (or uses X-Request-ID header if provided)
 * - Attaches requestId and scoped logger to req object
 * - Sets X-Request-ID response header for client correlation
 */
function requestLogger(req, res, next) {
  // Use existing request ID from header or generate new one
  const requestId = req.headers['x-request-id'] || generateRequestId();

  // Attach to request object
  req.requestId = requestId;
  req.log = createRequestLogger(requestId);

  // Set response header for client correlation
  res.setHeader('X-Request-ID', requestId);

  // Log request start
  req.log.info('Request started', {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    userAgent: req.headers['user-agent'],
    ip: req.ip
  });

  // Log response on finish
  const startTime = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level]('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });

  next();
}

module.exports = { requestLogger };
