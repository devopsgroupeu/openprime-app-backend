// src/worker.js
// Dedicated single-instance job worker entrypoint.
//
// Runs ONLY the async job worker (generate/push) as a standalone process, so
// the HTTP API pods can run with WORKER_ENABLED=false. Deployed as its own
// Deployment (chart/templates/worker-deployment.yaml) with replicas: 1, which
// fixes:
//   - A1: generated ZIPs are written by the worker to the shared uploads PVC
//     (ReadWriteMany) and served by any API pod.
//   - A2: a single worker means a rolling restart of the API pods no longer
//     requeues running jobs and double-pushes into customer repos.
//
// Deliberately does NOT start an HTTP server and does NOT run migrations
// (migrations run via the chart's separate migration Job).
require("dotenv").config();

const { logger } = require("./utils/logger");
const { initializeDatabase, closeConnection } = require("./config/database");
const { startWorker, stopWorker } = require("./services/jobProcessor");

// Initialize database and start the worker
async function startWorkerProcess() {
  try {
    // Initialize database connection and models. Required DB env vars are
    // validated in config/database.js at require time. The
    // CREDENTIALS_ENCRYPTION_KEY 64-hex check is intentionally NOT duplicated
    // here (server.js inlines it): the worker only needs the key to decrypt
    // SSH keys at push time, which the shared code handles.
    await initializeDatabase();
    logger.info("Database initialized successfully");

    // Start the async job worker (generate/push). No HTTP server and no
    // migrations — this process exists to drain the DB-backed queue.
    startWorker();
    logger.info("OpenPrime job worker started (dedicated worker process, no HTTP server)");

    // Graceful shutdown: stop claiming new jobs, drain in-flight work, requeue
    // anything still running, then close the DB connection. Mirrors server.js
    // ordering (stopWorker before closeConnection).
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully`);
      await stopWorker();
      await closeConnection();
      logger.info("Worker process terminated");
      process.exit(0);
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    // Crash visibility (mirrors server.js). Node already terminates on an
    // unhandled rejection, so without these the pod restarts with no record of
    // why — the log line, not the exit, is the point. State is undefined after
    // either event, so we let the process die and Kubernetes start a clean one.
    const exitOnFatal = (event) => (err) => {
      logger.error(`${event}, exiting`, {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      // Give the transport a tick to flush; stdout to a pipe is async in Node,
      // so exiting in the same turn can drop the line we just wrote.
      setTimeout(() => process.exit(1), 100);
    };

    process.on("unhandledRejection", exitOnFatal("Unhandled promise rejection"));
    process.on("uncaughtException", exitOnFatal("Uncaught exception"));
  } catch (error) {
    logger.error("Failed to start worker:", error);
    process.exit(1);
  }
}

// Only start the worker if this file is run directly (not imported)
if (require.main === module) {
  startWorkerProcess();
}
