// src/server.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const { errorHandler } = require("./middleware/errorHandler");
const { requestLogger } = require("./middleware/requestLogger");
const { logger } = require("./utils/logger");
const routes = require("./routes");
const { sequelize, initializeDatabase, closeConnection } = require("./config/database");
const { migrateOnStartup } = require("./config/umzug");

// Validate required environment variables
const requiredEnvVars = ["PORT", "FRONTEND_URL"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Fail closed if global TLS verification was disabled in production. Setting
// NODE_TLS_REJECT_UNAUTHORIZED=0 turns off certificate checks for every
// outbound HTTPS call (Keycloak JWKS, AWS, git, Bedrock), enabling MITM and
// token forgery — never acceptable in a deployed environment.
if (process.env.NODE_ENV === "production" && process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  throw new Error(
    "NODE_TLS_REJECT_UNAUTHORIZED=0 is not allowed in production (disables all TLS verification). Mount a CA bundle instead.",
  );
}

const app = express();
const PORT = process.env.PORT;

// Trust proxy when running behind ingress/load balancer
// Use 1 to trust only the immediate proxy (more secure than true)
app.set("trust proxy", 1);

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  }),
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});

app.use("/api/", limiter);

// Body parsing and compression
app.use(compression());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request logging with correlation ID
app.use(requestLogger);

// Liveness: cheap, dependency-free signal that the process is up.
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Readiness: Kubernetes routes traffic only when this passes. It verifies the
// database is reachable so a DB outage sheds load (503) instead of returning
// 500s to users.
app.get("/ready", async (req, res) => {
  const log = req.log || logger;
  try {
    await Promise.race([
      sequelize.authenticate(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("readiness check timed out")), 2500),
      ),
    ]);
    res.status(200).json({ status: "ready" });
  } catch (error) {
    log.warn("Readiness check failed", { error: error.message });
    res.status(503).json({ status: "not ready" });
  }
});

// API routes
app.use("/api", routes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database connection and models
    await initializeDatabase();
    logger.info("Database initialized successfully");

    // Apply (dev) or validate (prod) schema migrations before serving traffic
    await migrateOnStartup();

    // Start the server
    const server = app.listen(PORT, () => {
      logger.info(`OpenPrime Backend running on port ${PORT}`);
      logger.info("Database: PostgreSQL connected and ready");
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully");
      server.close(async () => {
        await closeConnection();
        logger.info("Process terminated");
        process.exit(0);
      });
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully");
      server.close(async () => {
        await closeConnection();
        logger.info("Process terminated");
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Only start server if this file is run directly (not imported)
if (require.main === module) {
  startServer();
}

module.exports = app;
