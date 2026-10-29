const { generateRequestId, createRequestLogger } = require("../utils/logger");
const { runWithRequestId } = require("../utils/requestContext");

// A client-supplied id is echoed back, written into every log record and
// forwarded to Injecto/StateCraft, so only adopt one shaped like an id.
const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Middleware to add request correlation ID and scoped logger to each request.
 * - Generates unique requestId (or uses a well-formed X-Request-ID header if provided)
 * - Attaches requestId and scoped logger to req object
 * - Sets X-Request-ID response header for client correlation
 */
function requestLogger(req, res, next) {
  // Use existing request ID from header if well-formed, else generate a new one
  const clientRequestId = req.headers["x-request-id"];
  // typeof first: RegExp#test coerces a missing header to "undefined", which matches.
  const requestId =
    typeof clientRequestId === "string" && CLIENT_REQUEST_ID_RE.test(clientRequestId)
      ? clientRequestId
      : generateRequestId();

  // Attach to request object
  req.requestId = requestId;
  req.log = createRequestLogger(requestId);

  // Set response header for client correlation
  res.setHeader("X-Request-ID", requestId);

  // Log request start
  req.log.info("Request started", {
    method: req.method,
    path: req.path,
    query: Object.keys(req.query).length > 0 ? req.query : undefined,
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  });

  // Log response on finish
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 400 ? "warn" : "info";
    req.log[level]("Request completed", {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  // Run the rest of the request within the correlation-id context so services and
  // the logger can read the requestId (and forward it to Injecto/StateCraft).
  runWithRequestId(requestId, () => next());
}

module.exports = { requestLogger };
