// tests/authMiddleware.test.js
// The real authenticateToken (setup.js mocks it everywhere else) against a
// local JWKS endpoint, with tokens signed by keys generated here (OP-262):
// - D80: a token with an unknown `kid` must not cost legitimate users anything,
//   and a JWKS outage is a 503, not a 401 (the frontend logs out on 401);
// - D25: a deactivated user is refused with 403;
// - D34: authenticated requests are limited per user, not per IP.
const http = require("http");
const crypto = require("crypto");
const { once } = require("events");
const express = require("express");
const jwt = require("jsonwebtoken");
const request = require("supertest");

const REALM = "test-realm";
const CLIENT_ID = "openprime-app";

function makeKey(kid) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" },
  };
}

const keyA = makeKey("key-a");
const keyB = makeKey("key-b");
const forger = makeKey("forged");

// The local "Keycloak": counts JWKS fetches and can be switched to failing.
const jwks = { keys: [keyA.jwk], status: 200, hits: 0 };
let server;
let issuer;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url !== `/realms/${REALM}/protocol/openid-connect/certs`) {
      res.writeHead(404);
      return res.end();
    }
    jwks.hits++;
    if (jwks.status !== 200) {
      res.writeHead(jwks.status);
      return res.end("unavailable");
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ keys: jwks.keys }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  process.env.KEYCLOAK_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.KEYCLOAK_CLIENT_ID = CLIENT_ID;
  issuer = `${process.env.KEYCLOAK_URL}/realms/${REALM}`;
});

afterAll(() => {
  server.close();
  delete process.env.KEYCLOAK_CLIENT_ID;
});

let realNow;
beforeEach(() => {
  jwks.keys = [keyA.jwk];
  jwks.status = 200;
  jwks.hits = 0;
  realNow = Date.now();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function token({ key = keyA, sub = "user-1", kid = key.kid } = {}) {
  return jwt.sign({ sub, azp: CLIENT_ID, preferred_username: sub }, key.privateKey, {
    algorithm: "RS256",
    keyid: kid,
    issuer,
    expiresIn: "1h",
  });
}

// A fresh copy of the real middleware (its key set and caches are module
// state) on a minimal app, plus the userService instance it talks to.
function loadApp() {
  let auth;
  let userService;
  jest.isolateModules(() => {
    auth = jest.requireActual("../src/middleware/auth");
    userService = require("../src/services/userService");
  });
  userService.getUserByKeycloakId.mockResolvedValue({ id: 1, is_active: true });
  const app = express();
  app.get("/api/thing", auth.authenticateToken, (req, res) => res.json({ id: req.user.id }));
  const get = (bearer) => request(app).get("/api/thing").set("Authorization", `Bearer ${bearer}`);
  return { get, userService };
}

const advanceClock = (ms) => jest.spyOn(Date, "now").mockReturnValue(realNow + ms);

describe("signing keys (D80)", () => {
  it("verifies tokens against keys fetched once, not per request", async () => {
    const { get } = loadApp();

    for (let i = 0; i < 5; i++) expect((await get(token())).status).toBe(200);
    expect(jwks.hits).toBe(1);
  });

  it("rejects unknown kids without fetching the JWKS for each of them", async () => {
    const { get } = loadApp();
    expect((await get(token())).status).toBe(200);

    for (let i = 0; i < 30; i++) {
      const res = await get(token({ key: forger, kid: `random-${i}` }));
      expect(res.status).toBe(401);
    }

    expect(jwks.hits).toBe(1);
    expect((await get(token())).status).toBe(200);
  });

  it("answers 503, not 401, when the JWKS cannot be fetched", async () => {
    jwks.status = 500;
    const { get } = loadApp();

    const res = await get(token());

    expect(res.status).toBe(503);
  });

  it("keeps verifying known keys while Keycloak is down", async () => {
    const { get } = loadApp();
    expect((await get(token())).status).toBe(200);

    jwks.status = 500;
    advanceClock(11 * 60 * 1000); // past the refresh interval

    expect((await get(token())).status).toBe(200);
  });

  it("picks up a rotated key on first sight, once the cooldown allows a fetch", async () => {
    const { get } = loadApp();
    expect((await get(token())).status).toBe(200);
    jwks.keys = [keyA.jwk, keyB.jwk];

    advanceClock(31 * 1000);
    expect((await get(token({ key: keyB }))).status).toBe(200);
    expect(jwks.hits).toBe(2);
  });

  it("drops a key Keycloak no longer publishes after the periodic refresh", async () => {
    const { get } = loadApp();
    expect((await get(token())).status).toBe(200);
    jwks.keys = [keyB.jwk];

    advanceClock(11 * 60 * 1000);
    await get(token()); // served from the old set; starts the refresh
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await get(token())).status).toBe(401);
  });

  it("rejects a token signed by a different key under a known kid", async () => {
    const { get } = loadApp();

    const res = await get(token({ key: forger, kid: keyA.kid }));

    expect(res.status).toBe(401);
  });
});

describe("deactivated users (D25)", () => {
  it("refuses a valid token of a deactivated user with 403", async () => {
    const { get, userService } = loadApp();
    userService.getUserByKeycloakId.mockResolvedValue({ id: 1, is_active: false });

    const res = await get(token({ sub: "deactivated-user" }));

    expect(res.status).toBe(403);
    expect(userService.getUserByKeycloakId).toHaveBeenCalledWith("deactivated-user");
  });

  it("lets a user without a row yet through (first login creates it)", async () => {
    const { get, userService } = loadApp();
    userService.getUserByKeycloakId.mockResolvedValue(null);

    expect((await get(token({ sub: "brand-new" }))).status).toBe(200);
  });

  it("caches the lookup briefly", async () => {
    const { get, userService } = loadApp();

    await get(token());
    await get(token());
    expect(userService.getUserByKeycloakId).toHaveBeenCalledTimes(1);

    advanceClock(31 * 1000);
    await get(token());
    expect(userService.getUserByKeycloakId).toHaveBeenCalledTimes(2);
  });

  it("answers 503 when the user lookup fails", async () => {
    const { get, userService } = loadApp();
    userService.getUserByKeycloakId.mockRejectedValue(new Error("db down"));

    expect((await get(token())).status).toBe(503);
  });
});

describe("per-user limit (D34)", () => {
  // Read from express-rate-limit's X-RateLimit-* headers rather than by spending
  // 600 requests: what is under test is the budget and its key.
  const budget = (res) => ({
    limit: Number(res.headers["x-ratelimit-limit"]),
    remaining: Number(res.headers["x-ratelimit-remaining"]),
  });

  it("gives each user a budget of their own, whatever IP they share", async () => {
    const { get } = loadApp();

    const alice1 = budget(await get(token({ sub: "alice" })));
    const alice2 = budget(await get(token({ sub: "alice" })));
    const bob1 = budget(await get(token({ sub: "bob" })));

    expect(alice1).toEqual({ limit: 600, remaining: 599 });
    expect(alice2.remaining).toBe(598);
    expect(bob1.remaining).toBe(599);
  });

  it("leaves job polling to the jobs route's own limiter", async () => {
    let auth;
    jest.isolateModules(() => {
      auth = jest.requireActual("../src/middleware/auth");
      require("../src/services/userService").getUserByKeycloakId.mockResolvedValue(null);
    });
    const jobs = express.Router();
    jobs.get("/:jobId", auth.authenticateToken, (req, res) => res.json({ ok: true }));
    const app = express();
    app.use("/api/jobs", jobs);

    const res = await request(app).get("/api/jobs/job-1").set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});
