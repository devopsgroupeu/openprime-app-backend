// tests/serverLimits.test.js
// Server-level limits (OP-262, D34): the JSON body limit, the per-IP limiter
// and the proxy trust it depends on. The per-user limit is tested with the
// real auth middleware in authMiddleware.test.js.
const request = require("supertest");

const app = require("../src/server");

// The largest legitimate body measured for OP-262 is ~120 KiB: an environment
// with all 15 catalog services enabled and every field filled to a high bound
// (50 tags at AWS's maximum size per tag map, 50 names per list).
const environmentOfSize = (bytes) => ({
  name: "acme-prod",
  provider: "aws",
  region: "eu-central-1",
  services: { vpc: { enabled: true, publicSubnetTags: { padding: "x".repeat(bytes) } } },
});

describe("JSON body limit", () => {
  it("refuses a 2 MB body with 413", async () => {
    const res = await request(app)
      .post("/api/environments")
      .send(environmentOfSize(2 * 1024 * 1024));

    expect(res.status).toBe(413);
  });

  it("still parses a body well above the largest legitimate one", async () => {
    const res = await request(app)
      .post("/api/environments")
      .send(environmentOfSize(400 * 1024));

    expect(res.status).not.toBe(413);
  });
});

describe("per-IP limit", () => {
  const getCatalog = (forwardedFor) =>
    request(app).get("/api/catalog").set("X-Forwarded-For", forwardedFor);

  // Colleagues behind one NAT share an IP; signed-in users have their own
  // budget, so the IP budget is only a flood guard.
  it("is sized for an office behind one NAT, not for one person", async () => {
    const res = await getCatalog("203.0.113.7");

    expect(Number(res.headers["x-ratelimit-limit"])).toBe(1000);
  });

  // Browser → ALB → pod: the ALB appends the address it saw to whatever
  // X-Forwarded-For the client sent, so only the last entry is trustworthy.
  it("keys on the address the ALB appended, not on one the client made up", async () => {
    const remaining = async (forwardedFor) =>
      Number((await getCatalog(forwardedFor)).headers["x-ratelimit-remaining"]);

    const first = await remaining("198.51.100.1, 192.0.2.10");
    const spoofed = await remaining("198.51.100.2, 192.0.2.10");
    const otherClient = await remaining("198.51.100.1, 192.0.2.11");

    expect(first).toBeGreaterThan(0);
    expect(spoofed).toBe(first - 1);
    expect(otherClient).toBe(first);
  });
});
