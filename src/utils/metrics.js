// src/utils/metrics.js
// Prometheus metrics for the API and the job worker.
//
// Served by a second HTTP listener on a DEDICATED port (METRICS_PORT, default
// 9090), never on the API port. The ingress routes "/" with a Prefix match on
// the public API host, so a /metrics route on the API port would publish route
// names, error rates, latency distributions and DB pool state to the internet.
// On its own port the endpoint is reachable only in-cluster, where Prometheus
// scrapes it through the chart's ServiceMonitor.
//
// http_requests_total and http_request_duration_seconds share their names,
// labels and buckets with Injecto and StateCraft, so one dashboard query shape
// works across all three services.
const http = require("http");
const client = require("@prometheus-io/client");
const { logger } = require("./logger");

const DEFAULT_METRICS_PORT = 9090;

const register = new client.Registry();

const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "HTTP requests handled, by method, matched route and status code",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds, by method, matched route and status code",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

// Generate/push run as async jobs, so their success rate and duration are
// measured here rather than by the HTTP histogram (the enqueue call is fast).
const jobsTotal = new client.Counter({
  name: "openprime_jobs_total",
  help: "Generate/push job executions, by type and outcome (succeeded, retried, failed)",
  labelNames: ["type", "outcome"],
  registers: [register],
});

const jobDurationSeconds = new client.Histogram({
  name: "openprime_job_duration_seconds",
  help: "Generate/push job execution time in seconds, by type and outcome",
  labelNames: ["type", "outcome"],
  // Up to the default 10-minute job deadline (JOB_DEADLINE_MS).
  buckets: [1, 2.5, 5, 10, 20, 30, 60, 120, 300, 600],
  registers: [register],
});

const jobsInFlight = new client.Gauge({
  name: "openprime_jobs_in_flight",
  help: "Generate/push jobs currently executing in this worker, by type",
  labelNames: ["type"],
  registers: [register],
});

const jobsExpiredTotal = new client.Counter({
  name: "openprime_jobs_expired_total",
  help: "Queued jobs failed by the deadline sweep before any worker ran them",
  registers: [register],
});

const bedrockRequestsTotal = new client.Counter({
  name: "openprime_bedrock_requests_total",
  help: "Bedrock calls, by operation and outcome (success, throttled, error)",
  labelNames: ["operation", "outcome"],
  registers: [register],
});

const bedrockRequestDurationSeconds = new client.Histogram({
  name: "openprime_bedrock_request_duration_seconds",
  help: "Bedrock call duration in seconds including throttling retries, by operation and outcome",
  labelNames: ["operation", "outcome"],
  buckets: [0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60],
  registers: [register],
});

const bedrockThrottlesTotal = new client.Counter({
  name: "openprime_bedrock_throttles_total",
  help: "ThrottlingException responses from Bedrock, including ones a retry absorbed",
  labelNames: ["operation"],
  registers: [register],
});

// The Sequelize instance whose pool the gauges below report on. Set by
// startMetricsServer so this module never requires config/database itself
// (that module validates DB env vars at require time).
let pooledSequelize = null;

function currentPool() {
  return pooledSequelize?.connectionManager?.pool;
}

// Pool gauges are read at scrape time, so they cost nothing between scrapes.
// Saturation is in_use / max; any pending acquire means requests are queueing
// for a connection.
new client.Gauge({
  name: "openprime_db_pool_connections",
  help: "Sequelize pool connections, by state (in_use, idle)",
  labelNames: ["state"],
  registers: [register],
  collect() {
    const pool = currentPool();
    if (!pool) return;
    this.set({ state: "in_use" }, pool.using);
    this.set({ state: "idle" }, pool.available);
  },
});

new client.Gauge({
  name: "openprime_db_pool_max_connections",
  help: "Configured maximum size of the Sequelize pool",
  registers: [register],
  collect() {
    const pool = currentPool();
    if (pool) this.set(pool.maxSize);
  },
});

new client.Gauge({
  name: "openprime_db_pool_pending_acquires",
  help: "Requests waiting for a Sequelize pool connection",
  registers: [register],
  collect() {
    const pool = currentPool();
    if (pool) this.set(pool.waiting);
  },
});

let metricsServer = null;
// Registering the default collectors twice throws, and they outlive a
// stop/start cycle, so they are registered once per process.
let defaultMetricsRegistered = false;

/**
 * Start the metrics listener on its own port.
 *
 * Idempotent per process. Never throws and never takes the process down: a
 * failure to expose metrics must not stop the service from serving traffic.
 *
 * @param {object} [options]
 * @param {object} [options.sequelize] - instance whose connection pool to report
 * @returns {http.Server|null} the listener, or null when disabled or misconfigured
 */
function startMetricsServer({ sequelize } = {}) {
  if (process.env.METRICS_ENABLED === "false") {
    logger.info("Metrics server disabled via METRICS_ENABLED=false");
    return null;
  }
  if (metricsServer) return metricsServer;

  pooledSequelize = sequelize || null;
  if (!defaultMetricsRegistered) {
    client.collectDefaultMetrics({ register });
    defaultMetricsRegistered = true;
  }

  const rawPort = process.env.METRICS_PORT || String(DEFAULT_METRICS_PORT);
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port > 65535) {
    logger.error("Metrics server not started: METRICS_PORT is not a valid port", {
      metricsPort: rawPort,
    });
    return null;
  }

  metricsServer = http.createServer(async (req, res) => {
    if (req.method !== "GET" || req.url.split("?")[0] !== "/metrics") {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = await register.metrics();
      res.writeHead(200, { "Content-Type": register.contentType }).end(body);
    } catch (error) {
      logger.error("Failed to collect metrics", { error: error.message });
      res.writeHead(500).end();
    }
  });

  metricsServer.on("error", (error) => {
    logger.error("Metrics server error", { port, error: error.message });
  });
  // The listener alone must never keep the process alive; shutdown is owned
  // by the API server / worker loop.
  metricsServer.unref();
  metricsServer.listen(port, () => {
    logger.info(`Prometheus metrics available on port ${port} at /metrics`);
  });

  return metricsServer;
}

/**
 * Close the metrics listener and reset module state (used by tests).
 * @returns {Promise<void>}
 */
function stopMetricsServer() {
  const server = metricsServer;
  metricsServer = null;
  pooledSequelize = null;
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

module.exports = {
  register,
  httpRequestsTotal,
  httpRequestDurationSeconds,
  jobsTotal,
  jobDurationSeconds,
  jobsInFlight,
  jobsExpiredTotal,
  bedrockRequestsTotal,
  bedrockRequestDurationSeconds,
  bedrockThrottlesTotal,
  startMetricsServer,
  stopMetricsServer,
};
