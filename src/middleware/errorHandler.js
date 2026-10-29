// src/middleware/errorHandler.js
const { logger } = require("../utils/logger");

exports.errorHandler = (err, req, res, _next) => {
  const log = req.log || logger;
  const statusCode = err.status || err.statusCode || 500;

  log.error("Request error", {
    error: err.message,
    name: err.name,
    code: err.code,
    statusCode,
    stack: err.stack,
  });

  // Validation errors
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "Validation Error",
      details: err.errors,
      requestId: req.requestId,
    });
  }

  // JWT errors
  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({
      error: "Invalid token",
      requestId: req.requestId,
    });
  }

  // Multer errors
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({
      error: "File too large",
      requestId: req.requestId,
    });
  }

  // Default error. A 5xx is unexpected by definition, so its message (SQL, AWS
  // ARNs, paths) stays in the log; only a message the code marked `expose` goes out.
  const exposeMessage = statusCode < 500 || err.expose === true;
  res.status(statusCode).json({
    error: (exposeMessage && err.message) || "Internal Server Error",
    requestId: req.requestId,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};
