const request = require("supertest");
const axios = require("axios");

// The catalog service is the thing under test here, so it must not be replaced
// by the global mock in tests/setup.js.
jest.unmock("../src/services/catalogService");
jest.mock("axios");

const app = require("../src/server");
const catalogService = require("../src/services/catalogService");

const CATALOG = {
  commit: "abc123",
  services: { vpc: { label: "VPC" }, eks: { label: "EKS" } },
  errors: [],
};

const ok = (etag = '"abc123"') => ({ status: 200, data: CATALOG, headers: { etag } });

describe("GET /api/catalog", () => {
  beforeEach(() => {
    catalogService.resetCache();
    axios.get.mockReset();
    // Deliberately not the real values. If either were "main" or the production
    // URL, a hardcoded literal in the service would satisfy the assertion below
    // and the test would agree with the bug it exists to catch.
    process.env.INFRA_TEMPLATES_REPO_URL = "https://example.invalid/not-the-real-repo";
    process.env.INFRA_TEMPLATES_BRANCH = "not-main-either";
  });

  // No 401 test here on purpose: tests/setup.js mocks authenticateToken to always
  // pass, so asserting a 401 would only prove the mock exists. The route declares
  // the middleware (src/routes/catalog.js); that is what review checks.

  it("returns the catalog with an ETag", async () => {
    axios.get.mockResolvedValue(ok());
    const res = await request(app).get("/api/catalog").set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(CATALOG);
    expect(res.headers.etag).toBe('"abc123"');
  });

  // The whole point of the proxy: the catalog the wizard renders from and the
  // templates a generate runs against must come from the same place. If these
  // two env vars ever diverge, the wizard offers fields the templates lack.
  it("asks Injecto for the same repo and branch generation uses", async () => {
    axios.get.mockResolvedValue(ok());
    await request(app).get("/api/catalog").set("Authorization", "Bearer test-token");

    const [url, config] = axios.get.mock.calls[0];
    expect(url).toBe(`${process.env.INJECTO_SERVICE_URL}/catalog`);
    expect(config.params).toEqual({
      repo_url: process.env.INFRA_TEMPLATES_REPO_URL,
      branch: process.env.INFRA_TEMPLATES_BRANCH,
    });
  });

  it("serves a fresh cache without calling Injecto again", async () => {
    axios.get.mockResolvedValue(ok());
    await request(app).get("/api/catalog").set("Authorization", "Bearer test-token");
    await request(app).get("/api/catalog").set("Authorization", "Bearer test-token");

    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("revalidates with If-None-Match once the TTL expires, and a 304 renews it", async () => {
    process.env.CATALOG_CACHE_TTL_MS = "0"; // every call revalidates

    axios.get.mockResolvedValueOnce(ok());
    await catalogService.getCatalog();

    axios.get.mockResolvedValueOnce({ status: 304, data: "", headers: {} });
    const second = await catalogService.getCatalog();

    expect(axios.get.mock.calls[1][1].headers["If-None-Match"]).toBe('"abc123"');
    // A 304 must not blank the document — it means "what you hold is current".
    expect(second.doc).toEqual(CATALOG);
    expect(second.etag).toBe('"abc123"');

    delete process.env.CATALOG_CACHE_TTL_MS;
  });

  it("serves the stale document when Injecto is unreachable", async () => {
    process.env.CATALOG_CACHE_TTL_MS = "0";

    axios.get.mockResolvedValueOnce(ok());
    await catalogService.getCatalog();

    axios.get.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const stale = await catalogService.getCatalog();

    expect(stale.doc).toEqual(CATALOG);
    expect(stale.stale).toBe(true);

    delete process.env.CATALOG_CACHE_TTL_MS;
  });

  // An empty cache plus an upstream failure is the one case a client can act
  // on, so it must not arrive as a generic 500.
  it("returns 502 catalog_unavailable when there is nothing to serve", async () => {
    axios.get.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await request(app).get("/api/catalog").set("Authorization", "Bearer test-token");

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/unavailable/i);
  });
});
