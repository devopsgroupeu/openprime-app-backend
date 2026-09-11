// tests/environment.test.js
const request = require("supertest");
const app = require("../src/server");

describe("Environment API", () => {
  describe("POST /api/environments", () => {
    it("should create a new environment", async () => {
      const environmentData = {
        name: "Test Environment",
        provider: "aws",
        region: "us-east-1",
        services: {
          vpc: { enabled: true, cidr: "10.0.0.0/16" },
          eks: { enabled: true, kubernetesVersion: "1.34" },
        },
      };

      const response = await request(app)
        .post("/api/environments")
        .send(environmentData)
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.name).toBe(environmentData.name);
    });

    it("should validate environment data", async () => {
      const invalidData = {
        provider: "invalid",
      };

      const response = await request(app).post("/api/environments").send(invalidData).expect(400);

      expect(response.body).toHaveProperty("errors");
    });
  });

  // Guards the OP-207 cut: per-service field rules moved to the catalog, so the
  // API must accept values the old hardcoded whitelist would have rejected.
  // Re-adding `services.rds.engine.isIn([...])` fails here rather than in the
  // wizard, where it shows up as a 400 on a value the UI itself offered.
  describe("validation does not duplicate the catalog", () => {
    it("accepts an rds engine outside the removed 4-engine whitelist", async () => {
      const res = await request(app)
        .post("/api/environments")
        .set("Authorization", "Bearer test-token")
        .send({
          name: "catalog-values",
          provider: "aws",
          region: "eu-west-1",
          services: {
            rds: { enabled: true, engine: "aurora-postgresql", version: "15.4" },
            eks: { enabled: true, kubernetesVersion: "1.34" },
          },
        });

      expect([200, 201]).toContain(res.status);
    });
  });
});
