// tests/metrics.test.js
// Prometheus metrics (OP-176): RED metrics by route pattern, the dedicated
// metrics listener, DB pool gauges, job outcomes and Bedrock calls.
const { once } = require("events");
const net = require("net");
const express = require("express");
const request = require("supertest");

const mockSend = jest.fn();
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  ConverseStreamCommand: jest.fn(),
  ConverseCommand: jest.fn(),
}));

const app = require("../src/server");
const { httpMetrics, createRouteSeries } = require("../src/middleware/httpMetrics");
const { register, startMetricsServer, stopMetricsServer } = require("../src/utils/metrics");
const { executeJob, startWorker, stopWorker } = require("../src/services/jobProcessor");
const { streamChat } = require("../src/services/aiService");
const environmentService = require("../src/services/environmentService");
const jobService = require("../src/services/jobService");
const { logger } = require("../src/utils/logger");

// Value of the series matching all given labels (0 when it does not exist yet).
async function valueOf(name, labels = {}, metricName = name) {
  const metric = register.getSingleMetric(name);
  const { values } = await metric.get();
  const match = values.find(
    (v) =>
      (v.metricName || name) === metricName &&
      Object.entries(labels).every(([key, value]) => v.labels[key] === value),
  );
  return match ? match.value : 0;
}

// Poll until check() is true; the server sees a client abort a moment later.
async function waitFor(check, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function routeLabels() {
  const { values } = await register.getSingleMetric("http_requests_total").get();
  return values.map((v) => v.labels.route);
}

describe("Metrics", () => {
  beforeEach(() => {
    register.resetMetrics();
    jest.clearAllMocks();
  });

  describe("httpMetrics middleware", () => {
    // Mirrors the real mount structure: app -> /api router -> /items router.
    function buildApp() {
      const testApp = express();
      testApp.use(httpMetrics);
      const items = express.Router();
      items.get("/", (req, res) => res.json([]));
      items.get("/:id", (req, res) => res.json({ id: req.params.id }));
      items.post("/:id/fail", (req, res, next) => next(new Error("boom")));
      items.get("/:id/hang", () => {}); // never answers
      const api = express.Router();
      api.use("/items", items);
      testApp.use("/api", api);
      testApp.get("/health", (req, res) => res.json({ status: "healthy" }));
      testApp.use((err, req, res, _next) => res.status(500).json({ error: err.message }));
      testApp.use((req, res) => res.status(404).json({ error: "Route not found" }));
      return testApp;
    }

    it("labels requests with the route pattern, never the raw path", async () => {
      const testApp = buildApp();
      await request(testApp).get("/api/items/abc").expect(200);
      await request(testApp).get("/api/items/def").expect(200);

      expect(
        await valueOf("http_requests_total", {
          method: "GET",
          route: "/api/items/:id",
          status_code: "200",
        }),
      ).toBe(2);
      expect(await routeLabels()).toEqual(["/api/items/:id"]);
    });

    it("labels a router's root route with its mount path", async () => {
      await request(buildApp()).get("/api/items").expect(200);

      expect(await routeLabels()).toEqual(["/api/items"]);
    });

    it("keeps the full pattern when an error reaches the app-level handler", async () => {
      await request(buildApp()).post("/api/items/abc/fail").expect(500);

      expect(
        await valueOf("http_requests_total", {
          method: "POST",
          route: "/api/items/:id/fail",
          status_code: "500",
        }),
      ).toBe(1);
    });

    it("groups requests no route matched under one label", async () => {
      const testApp = buildApp();
      await request(testApp).get("/no/such/path").expect(404);
      await request(testApp).get("/another/missing/path").expect(404);

      expect(await valueOf("http_requests_total", { route: "unmatched", status_code: "404" })).toBe(
        2,
      );
    });

    it("records request duration with the same labels", async () => {
      await request(buildApp()).get("/api/items/abc").expect(200);

      expect(
        await valueOf(
          "http_request_duration_seconds",
          { route: "/api/items/:id", status_code: "200" },
          "http_request_duration_seconds_count",
        ),
      ).toBe(1);
    });

    it("does not count probe traffic", async () => {
      await request(buildApp()).get("/health").expect(200);

      expect(await routeLabels()).toEqual([]);
    });

    it("records a request the client abandons as a 499", async () => {
      await request(buildApp())
        .get("/api/items/abc/hang")
        .timeout(50)
        .catch(() => {});

      await waitFor(
        async () =>
          (await valueOf("http_requests_total", {
            route: "/api/items/:id/hang",
            status_code: "499",
          })) === 1,
      );
    });
  });

  describe("API app", () => {
    it("collapses case variants of a mount path into one label", async () => {
      // Express matches mounts case-insensitively; the label must not echo the
      // client's casing, or anyone could mint new series without logging in.
      await request(app).get("/API/EnViRoNmEnTs/x");
      await request(app).get("/api/environments/x");

      expect(await routeLabels()).toEqual(["/api/environments/:id"]);
    });

    it("never serves /metrics on the API port", async () => {
      const response = await request(app).get("/metrics").expect(404);

      expect(response.text).not.toContain("http_requests_total");
    });

    it("does not count liveness or readiness probes", async () => {
      await request(app).get("/health").expect(200);
      await request(app).get("/ready").expect(200);

      expect(await routeLabels()).toEqual([]);
    });

    it("counts CORS preflights, which cors() answers before any route", async () => {
      // Only holds while httpMetrics is mounted ahead of cors().
      await request(app)
        .options("/api/environments/x")
        .set("Origin", process.env.FRONTEND_URL)
        .set("Access-Control-Request-Method", "PUT")
        .expect(204);

      expect(
        await valueOf("http_requests_total", {
          method: "OPTIONS",
          route: "unmatched",
          status_code: "204",
        }),
      ).toBe(1);
    });
  });

  // Series created at startup (OP-176 review): a labelled series otherwise
  // appears with its first request, already at 1, and increase() never sees it.
  describe("route series created at startup", () => {
    const { mounts } = require("../src/routes");

    // Every series of a metric, as "METHOD route status" strings.
    async function seriesOf(name, metricName = name) {
      const { values } = await register.getSingleMetric(name).get();
      return values
        .filter((v) => (v.metricName || name) === metricName)
        .map((v) => `${v.labels.method} ${v.labels.route} ${v.labels.status_code}`);
    }

    it("lists the status codes of every registered route, and no route that is gone", () => {
      for (const [mountPath, router] of Object.entries(mounts)) {
        const registered = router.stack
          .filter((layer) => layer.route)
          .flatMap((layer) =>
            Object.keys(layer.route.methods).map((m) => `${m.toUpperCase()} ${layer.route.path}`),
          );
        expect({ mountPath, routes: Object.keys(router.statusCodes || {}).sort() }).toEqual({
          mountPath,
          routes: [...registered].sort(),
        });
      }
    });

    it("creates each route's series at zero, for its own codes and the auth codes", async () => {
      createRouteSeries("/api", mounts);

      const counters = await seriesOf("http_requests_total");
      expect(counters).toEqual(
        expect.arrayContaining([
          "POST /api/environments/:id/generate 202",
          "POST /api/environments/:id/generate 500",
          "POST /api/environments/:id/generate 401",
          "GET /api/environments 200",
          "GET /api/catalog 502",
          "POST /api/ai/chat 200",
        ]),
      );
      expect(counters.some((s) => s.includes("unmatched"))).toBe(false);
      // Every route gets the abandoned-request code, every GET the revalidation
      // code, and the job routes the per-repository lock's 409.
      const routesAndMethods = new Set(counters.map((s) => s.split(" ").slice(0, 2).join(" ")));
      for (const routeAndMethod of routesAndMethods) {
        expect(counters).toContain(`${routeAndMethod} 499`);
        if (routeAndMethod.startsWith("GET ")) expect(counters).toContain(`${routeAndMethod} 304`);
      }
      expect(counters).toEqual(
        expect.arrayContaining([
          "POST /api/environments/:id/push 409",
          "POST /api/environments/:id/generate 409",
          "POST /api/environments/terraform-backend/create 409",
        ]),
      );
      const { values } = await register.getSingleMetric("http_requests_total").get();
      expect(values.every((v) => v.value === 0)).toBe(true);
      // The histogram has the same series, with every bucket at zero.
      expect(
        await seriesOf("http_request_duration_seconds", "http_request_duration_seconds_count"),
      ).toEqual(counters);
    });

    it("gives the series exactly the labels the middleware records", async () => {
      createRouteSeries("/api", mounts);
      const before = await seriesOf("http_requests_total");

      // Real requests through the app (auth and services are mocked in setup.js).
      await request(app).post("/api/environments/abc/generate");
      await request(app).get("/api/users/me");
      // A browser revalidating with the ETag it got: 304.
      const first = await request(app).get("/api/environments");
      await request(app)
        .get("/api/environments")
        .set("If-None-Match", first.headers.etag)
        .expect(304);

      // No new series: each request landed on one created at startup, which
      // also means the route answered with a code its statusCodes list.
      expect(await seriesOf("http_requests_total")).toEqual(before);
      const { values } = await register.getSingleMetric("http_requests_total").get();
      expect(values.reduce((sum, v) => sum + v.value, 0)).toBe(4);
    });

    it("is wired into the app: loading the server creates the series", async () => {
      // beforeEach resets the shared registry, so load a fresh copy of the app.
      let fresh;
      jest.isolateModules(() => {
        require("../src/server");
        fresh = require("../src/utils/metrics").register;
      });

      const { values } = await fresh.getSingleMetric("http_requests_total").get();
      expect(
        values.map((v) => `${v.labels.method} ${v.labels.route} ${v.labels.status_code}`),
      ).toEqual(expect.arrayContaining(["POST /api/environments/:id/generate 202"]));
    });
  });

  describe("metrics listener", () => {
    afterEach(async () => {
      delete process.env.METRICS_PORT;
      delete process.env.METRICS_ENABLED;
      await stopMetricsServer();
    });

    async function startOnEphemeralPort(options) {
      process.env.METRICS_PORT = "0";
      const server = startMetricsServer(options);
      if (!server.listening) await once(server, "listening");
      return `http://127.0.0.1:${server.address().port}`;
    }

    it("serves Prometheus text format at /metrics, including default process metrics", async () => {
      const url = await startOnEphemeralPort();

      const response = await request(url).get("/metrics").expect(200);

      expect(response.headers["content-type"]).toMatch(/^text\/plain/);
      expect(response.text).toContain("# TYPE http_requests_total counter");
      expect(response.text).toContain("process_cpu_user_seconds_total");
    });

    it("returns 404 for any other path", async () => {
      const url = await startOnEphemeralPort();

      await request(url).get("/").expect(404);
      await request(url).get("/api/environments").expect(404);
    });

    it("reports DB pool saturation from the given Sequelize instance", async () => {
      const sequelize = {
        connectionManager: { pool: { using: 3, available: 2, waiting: 1, maxSize: 5 } },
      };
      const url = await startOnEphemeralPort({ sequelize });

      const { text } = await request(url).get("/metrics").expect(200);

      expect(text).toContain('openprime_db_pool_connections{state="in_use"} 3');
      expect(text).toContain('openprime_db_pool_connections{state="idle"} 2');
      expect(text).toContain("openprime_db_pool_max_connections 5");
      expect(text).toContain("openprime_db_pool_pending_acquires 1");
    });

    it("does not start when METRICS_ENABLED=false", () => {
      process.env.METRICS_ENABLED = "false";

      expect(startMetricsServer()).toBeNull();
    });

    it("does not start, and does not throw, on an invalid METRICS_PORT", () => {
      process.env.METRICS_PORT = "metrics";

      expect(startMetricsServer()).toBeNull();
    });

    it("logs, rather than crashes, when the metrics port is already taken", async () => {
      const blocker = net.createServer().listen(0);
      await once(blocker, "listening");
      process.env.METRICS_PORT = String(blocker.address().port);

      try {
        // No "error" listener of our own: if the module did not handle the
        // event, it would throw here as it would take the API pod down.
        startMetricsServer();

        await waitFor(() => logger.error.mock.calls.length > 0);
        expect(logger.error).toHaveBeenCalledWith(
          "Metrics server error",
          expect.objectContaining({ error: expect.stringContaining("EADDRINUSE") }),
        );
      } finally {
        await new Promise((resolve) => blocker.close(resolve));
      }
    });
  });

  describe("job outcomes", () => {
    const job = (overrides = {}) => ({
      id: "job-1",
      type: "generate",
      attempts: 1,
      max_attempts: 3,
      payload: { environment: { id: "env-1", user_id: 1 } },
      ...overrides,
    });

    it("counts a successful job and its duration", async () => {
      await executeJob(job());

      expect(
        await valueOf("openprime_jobs_total", { type: "generate", outcome: "succeeded" }),
      ).toBe(1);
      expect(
        await valueOf(
          "openprime_job_duration_seconds",
          { type: "generate", outcome: "succeeded" },
          "openprime_job_duration_seconds_count",
        ),
      ).toBe(1);
    });

    it("counts a permanent failure as failed", async () => {
      environmentService.generateInfrastructure.mockRejectedValueOnce(
        new Error("permission denied"),
      );

      await executeJob(job());

      expect(await valueOf("openprime_jobs_total", { type: "generate", outcome: "failed" })).toBe(
        1,
      );
    });

    it("creates every outcome series at zero when the worker starts", async () => {
      await startWorker();
      await stopWorker();

      const { values } = await register.getSingleMetric("openprime_jobs_total").get();
      expect(values).toHaveLength(6);
      expect(values.every((v) => v.value === 0)).toBe(true);
      // The duration histogram too, so a first job shows in the duration panels.
      const durations = await register.getSingleMetric("openprime_job_duration_seconds").get();
      const counts = durations.values.filter(
        (v) => v.metricName === "openprime_job_duration_seconds_count",
      );
      expect(counts).toHaveLength(6);
      expect(durations.values.every((v) => v.value === 0)).toBe(true);
    });

    it("waits before the first claim, so Prometheus scrapes the zeroed series first", async () => {
      jest.useFakeTimers();
      process.env.JOB_START_DELAY_MS = "45000";
      try {
        // startWorker runs once per module, so load a fresh copy of the worker.
        let worker;
        let jobs;
        jest.isolateModules(() => {
          worker = require("../src/services/jobProcessor");
          jobs = require("../src/services/jobService");
        });
        jobs.claimNextJob.mockResolvedValue(null);

        await worker.startWorker();
        await jest.advanceTimersByTimeAsync(44_000);
        expect(jobs.claimNextJob).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(2_000);
        expect(jobs.claimNextJob).toHaveBeenCalled();

        await worker.stopWorker();
      } finally {
        delete process.env.JOB_START_DELAY_MS;
        jest.useRealTimers();
      }
    });

    it("counts a transient failure with attempts left as retried", async () => {
      environmentService.generateInfrastructure.mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 10.0.0.1:8000"),
      );

      await executeJob(job());

      expect(await valueOf("openprime_jobs_total", { type: "generate", outcome: "retried" })).toBe(
        1,
      );
      expect(await valueOf("openprime_jobs_total", { outcome: "failed" })).toBe(0);
    });

    it("does not count an outcome the jobs table never recorded", async () => {
      environmentService.generateInfrastructure.mockRejectedValueOnce(
        new Error("connect ECONNREFUSED 10.0.0.1:8000"),
      );
      jobService.markForRetry.mockRejectedValueOnce(new Error("database unavailable"));

      await expect(executeJob(job())).rejects.toThrow("database unavailable");

      expect(await valueOf("openprime_jobs_total", { type: "generate", outcome: "retried" })).toBe(
        0,
      );
      expect(
        await valueOf(
          "openprime_job_duration_seconds",
          { type: "generate" },
          "openprime_job_duration_seconds_count",
        ),
      ).toBe(0);
    });
  });

  describe("Bedrock calls", () => {
    async function* streamOf(...texts) {
      for (const text of texts) {
        yield { contentBlockDelta: { delta: { text } } };
      }
    }

    // Already in Bedrock's format: streamChat sends what buildChatRequest built.
    const hi = {
      system: [{ text: "system" }],
      messages: [{ role: "user", content: [{ text: "hi" }] }],
    };

    const throttle = () =>
      Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" });

    it("creates every call and duration series at zero when the service loads", async () => {
      // beforeEach resets the shared registry, so load a fresh copy of both modules.
      let fresh;
      jest.isolateModules(() => {
        require("../src/services/aiService");
        fresh = require("../src/utils/metrics").register;
      });

      const calls = await fresh.getSingleMetric("openprime_bedrock_requests_total").get();
      const durations = await fresh
        .getSingleMetric("openprime_bedrock_request_duration_seconds")
        .get();
      const counts = durations.values.filter(
        (v) => v.metricName === "openprime_bedrock_request_duration_seconds_count",
      );
      expect(calls.values).toHaveLength(6);
      expect(counts).toHaveLength(6);
      expect([...calls.values, ...durations.values].every((v) => v.value === 0)).toBe(true);
    });

    // aiService reports retries and fallbacks on the console; keep test output clean.
    beforeEach(() => {
      jest.spyOn(console, "warn").mockImplementation(() => {});
      jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("counts throttles a retry absorbed, and the call as a success", async () => {
      mockSend
        .mockRejectedValueOnce(throttle())
        .mockResolvedValueOnce({ stream: streamOf("Hello", " world") });
      const onChunk = jest.fn();

      await streamChat(hi, onChunk);

      expect(onChunk).toHaveBeenCalledWith("Hello world", { done: true });
      expect(
        await valueOf("openprime_bedrock_throttles_total", { operation: "ConverseStream" }),
      ).toBe(1);
      expect(
        await valueOf("openprime_bedrock_requests_total", {
          operation: "ConverseStream",
          outcome: "success",
        }),
      ).toBe(1);
    });

    it("counts a throttle that arrives mid-stream exactly once", async () => {
      async function* throttledStream() {
        yield { contentBlockDelta: { delta: { text: "partial" } } };
        throw throttle();
      }
      mockSend.mockResolvedValueOnce({ stream: throttledStream() }).mockResolvedValueOnce({
        output: { message: { content: [{ text: "fallback" }] } },
      });

      await streamChat(hi, jest.fn());

      expect(
        await valueOf("openprime_bedrock_throttles_total", { operation: "ConverseStream" }),
      ).toBe(1);
      expect(
        await valueOf("openprime_bedrock_requests_total", {
          operation: "ConverseStream",
          outcome: "throttled",
        }),
      ).toBe(1);
    });

    it("counts each throttled attempt once when the retries run out", async () => {
      // The first call plus sendWithRetry's 5 retries, all throttled.
      for (let attempt = 0; attempt < 6; attempt++) mockSend.mockRejectedValueOnce(throttle());
      mockSend.mockResolvedValueOnce({ output: { message: { content: [{ text: "fallback" }] } } });

      jest.useFakeTimers();
      try {
        const chat = streamChat(hi, jest.fn());
        await jest.runAllTimersAsync(); // the backoff sleeps between attempts
        await chat;
      } finally {
        jest.useRealTimers();
      }

      expect(
        await valueOf("openprime_bedrock_throttles_total", { operation: "ConverseStream" }),
      ).toBe(6);
      expect(
        await valueOf("openprime_bedrock_requests_total", {
          operation: "ConverseStream",
          outcome: "throttled",
        }),
      ).toBe(1);
      expect(
        await valueOf("openprime_bedrock_requests_total", {
          operation: "Converse",
          outcome: "success",
        }),
      ).toBe(1);
    });

    it("records a failed stream as an error and the fallback call separately", async () => {
      mockSend.mockRejectedValueOnce(new Error("stream broke")).mockResolvedValueOnce({
        output: { message: { content: [{ text: "fallback" }] } },
      });
      const onChunk = jest.fn();

      await streamChat(hi, onChunk);

      expect(onChunk).toHaveBeenCalledWith("fallback", { done: true });
      expect(
        await valueOf("openprime_bedrock_requests_total", {
          operation: "ConverseStream",
          outcome: "error",
        }),
      ).toBe(1);
      expect(
        await valueOf("openprime_bedrock_requests_total", {
          operation: "Converse",
          outcome: "success",
        }),
      ).toBe(1);
    });
  });
});
