// src/middleware/errorHandler.js
const { logger } = require("../utils/logger");

exports.errorHandler = (err, req, res, _next) => {
  const log = req.log || logger;
  const statusCode = err.status || 500;

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

  // Default error
  res.status(statusCode).json({
    error: err.message || "Internal Server Error",
    requestId: req.requestId,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};
