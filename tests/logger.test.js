// tests/logger.test.js
// With no transport at all, winston prints every record to stderr itself, before
// any format runs: unredacted, and at every level including debug. That was the
// state in Kubernetes with the chart defaults (NODE_ENV=production, no
// CONSOLE_LOGGING). The logger must always end up with a transport.
jest.unmock("../src/utils/logger");

const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");

const ENV_KEYS = [
  "NODE_ENV",
  "LOG_LEVEL",
  "KUBERNETES_SERVICE_HOST",
  "CONSOLE_LOGGING",
  "FILE_LOGGING",
];

// Load a fresh copy of the logger under the given environment.
function loadLogger(env) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, { LOG_LEVEL: "info", ...env });
  try {
    let logger;
    jest.isolateModules(() => {
      ({ logger } = require("../src/utils/logger"));
    });
    return logger;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const transportNames = (logger) => logger.transports.map((t) => t.constructor.name);

// Everything the process writes while fn runs, by any route winston might take,
// up to the point where `until` has been written.
async function captureOutput(fn, until) {
  const chunks = [];
  const record = (...args) => {
    chunks.push(util.format(...args));
    return true;
  };
  // Under jest, console._stdout is not always process.stdout itself.
  const streams = new Set(
    [process.stdout, process.stderr, console._stdout, console._stderr].filter(Boolean),
  );
  const spies = [
    ...[...streams].map((stream) => jest.spyOn(stream, "write").mockImplementation(record)),
    jest.spyOn(console, "log").mockImplementation(record),
    jest.spyOn(console, "error").mockImplementation(record),
    jest.spyOn(console, "warn").mockImplementation(record),
  ];
  try {
    await fn();
    // Records reach a transport through streams, so wait for the write itself
    // rather than for a fixed number of ticks.
    for (let i = 0; i < 200 && !chunks.join("\n").includes(until); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
  return chunks.join("\n");
}

const KUBERNETES = { KUBERNETES_SERVICE_HOST: "10.0.0.1" };

describe("logger transports", () => {
  it("logs to the console in Kubernetes with the chart's default env", () => {
    const logger = loadLogger({ ...KUBERNETES, NODE_ENV: "production" });

    expect(transportNames(logger)).toEqual(["Console"]);
  });

  it("sends a record through redaction instead of dumping it raw", async () => {
    // Load inside the capture: winston's Console transport binds console.log
    // when it is constructed. Debug first, so by the time the info record is
    // out, the debug one has been through the same pipeline.
    const output = await captureOutput(() => {
      const logger = loadLogger({ ...KUBERNETES, NODE_ENV: "production" });
      logger.debug("below LOG_LEVEL", { note: "DEBUG-ONLY-RECORD" });
      logger.info("Environment creation request", {
        body: { name: "prod", sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----SECRETMATERIAL" },
      });
    }, "Environment creation request");

    expect(output).toContain('"sshKey":"[REDACTED]"');
    expect(output).not.toContain("SECRETMATERIAL");
    expect(output).not.toContain("DEBUG-ONLY-RECORD");
  });

  // CONSOLE_LOGGING=false cannot switch logging off where console is the only
  // transport: no transport at all is the raw, unredacted dump above.
  describe.each([
    ["Kubernetes", KUBERNETES],
    ["outside Kubernetes without file logging", { FILE_LOGGING: "false" }],
  ])("%s", (_label, base) => {
    it.each([
      ["production", undefined],
      ["production", "true"],
      ["production", "false"],
      ["development", undefined],
      ["development", "false"],
    ])("NODE_ENV=%s CONSOLE_LOGGING=%s has a transport", (nodeEnv, consoleLogging) => {
      const env = { ...base, NODE_ENV: nodeEnv };
      if (consoleLogging !== undefined) env.CONSOLE_LOGGING = consoleLogging;

      expect(loadLogger(env).transports.length).toBeGreaterThan(0);
    });
  });

  describe("with file logging (outside Kubernetes)", () => {
    const cwd = process.cwd();
    let tmp;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "logger-test-"));
      process.chdir(tmp);
    });

    afterEach(() => {
      process.chdir(cwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("still honours CONSOLE_LOGGING=false", () => {
      const logger = loadLogger({ NODE_ENV: "development", CONSOLE_LOGGING: "false" });

      expect(transportNames(logger)).toEqual(["File", "File"]);
    });

    it("keeps production file-only unless CONSOLE_LOGGING=true", () => {
      expect(transportNames(loadLogger({ NODE_ENV: "production" }))).toEqual(["File", "File"]);
      expect(
        transportNames(loadLogger({ NODE_ENV: "production", CONSOLE_LOGGING: "true" })),
      ).toEqual(["File", "File", "Console"]);
    });
  });
});
