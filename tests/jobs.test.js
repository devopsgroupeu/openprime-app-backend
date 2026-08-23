// tests/jobs.test.js
// Async job model (P1): generate/push enqueue DB-backed jobs and return
// 202 + jobId; the UI polls GET /api/jobs/:jobId.
const request = require("supertest");
const app = require("../src/server");
const environmentService = require("../src/services/environmentService");
const jobService = require("../src/services/jobService");

const mockEnvironment = {
  id: "env-1",
  name: "Test Env",
  global_prefix: "op-",
  provider: "aws",
  region: "us-east-1",
  status: "pending",
  services: { vpc: { enabled: true } },
  terraform_backend: null,
  git_repository: {
    enabled: true,
    url: "git@github.com:test-org/infra-repo.git",
    branch: "main",
    // Redacted wire form: no key material, readiness exposed via the flag.
    sshKeyConfigured: true,
  },
  user_id: 1,
};

describe("Async job API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("POST /api/environments/:id/generate", () => {
    it("returns 202 with a jobId when X-Async-Jobs is true", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue(mockEnvironment);
      jobService.enqueue.mockResolvedValue({ id: "job-gen-1", type: "generate", status: "queued" });

      const response = await request(app)
        .post("/api/environments/env-1/generate")
        .set("X-Async-Jobs", "true")
        .send({})
        .expect(202);

      expect(response.body).toEqual({ jobId: "job-gen-1", type: "generate", status: "queued" });
      expect(jobService.enqueue).toHaveBeenCalledWith(
        "generate",
        mockEnvironment,
        expect.objectContaining({ userId: 1 }),
      );
      expect(environmentService.generateInfrastructure).not.toHaveBeenCalled();
    });

    it("returns 404 when the environment does not exist", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/environments/env-missing/generate")
        .set("X-Async-Jobs", "true")
        .send({})
        .expect(404);

      expect(response.body.error).toBe("Environment not found");
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it("forwards the Idempotency-Key header to the job service", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue(mockEnvironment);
      jobService.enqueue.mockResolvedValue({ id: "job-gen-1", type: "generate", status: "queued" });

      await request(app)
        .post("/api/environments/env-1/generate")
        .set("X-Async-Jobs", "true")
        .set("Idempotency-Key", "gen-key-123")
        .send({})
        .expect(202);

      expect(jobService.enqueue).toHaveBeenCalledWith(
        "generate",
        mockEnvironment,
        expect.objectContaining({ idempotencyKey: "gen-key-123" }),
      );
    });

    it("streams the ZIP synchronously when X-Async-Jobs is absent", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue(mockEnvironment);
      environmentService.generateInfrastructure.mockResolvedValue(Buffer.from("mock-zip-bytes"));

      const response = await request(app)
        .post("/api/environments/env-1/generate")
        .send({})
        .expect(200);

      expect(response.headers["content-type"]).toContain("application/zip");
      expect(response.headers["content-disposition"]).toBe(
        "attachment; filename=Test Env-infrastructure.zip",
      );
      // supertest does not parse non-JSON bodies into res.body; the raw stream
      // is available as res.text.
      expect(response.text).toBe("mock-zip-bytes");
      expect(environmentService.generateInfrastructure).toHaveBeenCalledWith(mockEnvironment);
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it("returns 404 when the environment does not exist (sync path)", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue(null);

      const response = await request(app)
        .post("/api/environments/env-missing/generate")
        .send({})
        .expect(404);

      expect(response.body.error).toBe("Environment not found");
      expect(environmentService.generateInfrastructure).not.toHaveBeenCalled();
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/environments/:id/push", () => {
    it("returns 202 with a jobId when git is configured and X-Async-Jobs is true", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue(mockEnvironment);
      jobService.enqueue.mockResolvedValue({ id: "job-push-1", type: "push", status: "queued" });

      const response = await request(app)
        .post("/api/environments/env-1/push")
        .set("X-Async-Jobs", "true")
        .send({})
        .expect(202);

      expect(response.body).toEqual({ jobId: "job-push-1", type: "push", status: "queued" });
      expect(jobService.enqueue).toHaveBeenCalledWith(
        "push",
        mockEnvironment,
        expect.objectContaining({ userId: 1 }),
      );
      expect(environmentService.pushInfrastructure).not.toHaveBeenCalled();
    });

    it("returns 400 when the git repository is not configured", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue({
        ...mockEnvironment,
        git_repository: null,
      });

      const response = await request(app)
        .post("/api/environments/env-1/push")
        .set("X-Async-Jobs", "true")
        .send({})
        .expect(400);

      expect(response.body.error).toBe("Git repository is not configured");
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it("returns 409 when another environment holds the per-repo lock", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue(mockEnvironment);
      const conflict = new jobService.JobConflictError(
        "Another push to this repository is already in progress",
      );
      jobService.enqueue.mockRejectedValue(conflict);

      const response = await request(app)
        .post("/api/environments/env-1/push")
        .set("X-Async-Jobs", "true")
        .send({})
        .expect(409);

      expect(response.body.error).toBe("Another push to this repository is already in progress");
    });

    it("pushes synchronously and returns JSON when X-Async-Jobs is absent", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue(mockEnvironment);
      environmentService.generateInfrastructure.mockResolvedValue(Buffer.from("mock-zip-bytes"));
      environmentService.getGitRepositoryForPush.mockResolvedValue({
        url: "git@github.com:test-org/infra-repo.git",
        branch: "main",
        sshKey: "decrypted-key",
      });
      environmentService.pushInfrastructure.mockResolvedValue({
        status: "success",
        message: "Infrastructure pushed to Git",
        branch: "main",
      });

      const response = await request(app).post("/api/environments/env-1/push").send({}).expect(200);

      expect(response.body).toEqual({
        status: "success",
        message: "Infrastructure pushed to Git",
        branch: "main",
      });
      expect(environmentService.generateInfrastructure).toHaveBeenCalledWith(mockEnvironment);
      expect(environmentService.getGitRepositoryForPush).toHaveBeenCalledWith("env-1", 1);
      expect(environmentService.pushInfrastructure).toHaveBeenCalledWith(
        Buffer.from("mock-zip-bytes"),
        { url: "git@github.com:test-org/infra-repo.git", branch: "main", sshKey: "decrypted-key" },
      );
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });

    it("returns 400 when git is not configured (sync path)", async () => {
      environmentService.getEnvironmentByIdAndUser.mockResolvedValue({
        ...mockEnvironment,
        git_repository: null,
      });

      const response = await request(app).post("/api/environments/env-1/push").send({}).expect(400);

      expect(response.body.error).toBe("Git repository is not configured");
      expect(environmentService.generateInfrastructure).not.toHaveBeenCalled();
      expect(environmentService.pushInfrastructure).not.toHaveBeenCalled();
      expect(jobService.enqueue).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/jobs/:jobId", () => {
    it("returns the job status for polling", async () => {
      jobService.getJobByIdAndUser.mockResolvedValue({
        id: "job-gen-1",
        type: "generate",
        status: "succeeded",
        attempts: 1,
        max_attempts: 3,
        result: {
          message: "Infrastructure generated successfully",
          downloadUrl: "/jobs/job-gen-1/download",
        },
        error: null,
        created_at: new Date("2026-08-19T10:00:00Z"),
        started_at: new Date("2026-08-19T10:00:01Z"),
        finished_at: new Date("2026-08-19T10:00:05Z"),
      });

      const response = await request(app).get("/api/jobs/job-gen-1").expect(200);

      expect(response.body).toMatchObject({
        id: "job-gen-1",
        type: "generate",
        status: "succeeded",
        attempts: 1,
        maxAttempts: 3,
      });
      expect(response.body.result.downloadUrl).toBe("/jobs/job-gen-1/download");
    });

    it("returns 404 when the job does not exist or belongs to another user", async () => {
      jobService.getJobByIdAndUser.mockResolvedValue(null);

      const response = await request(app).get("/api/jobs/job-unknown").expect(404);

      expect(response.body.error).toBe("Job not found");
    });
  });

  describe("GET /api/jobs/:jobId/download", () => {
    it("returns 404 when the job does not exist", async () => {
      jobService.getJobByIdAndUser.mockResolvedValue(null);

      await request(app).get("/api/jobs/job-unknown/download").expect(404);
    });

    it("returns 400 for a push job (no artifact)", async () => {
      jobService.getJobByIdAndUser.mockResolvedValue({
        id: "job-push-1",
        type: "push",
        status: "succeeded",
        payload: { environment: { name: "Test Env" } },
      });

      const response = await request(app).get("/api/jobs/job-push-1/download").expect(400);

      expect(response.body.error).toBe("This job has no downloadable artifact");
    });

    it("returns 409 while the generate job is still running", async () => {
      jobService.getJobByIdAndUser.mockResolvedValue({
        id: "job-gen-1",
        type: "generate",
        status: "running",
        payload: { environment: { name: "Test Env" } },
      });

      const response = await request(app).get("/api/jobs/job-gen-1/download").expect(409);

      expect(response.body.error).toBe("Job has not completed successfully yet");
    });

    it("streams the artifact from the job row when it exists", async () => {
      jobService.getJobByIdAndUser.mockResolvedValue({
        id: "job-gen-1",
        type: "generate",
        status: "succeeded",
        payload: { environment: { name: "Test Env" } },
        artifact: Buffer.from("mock-zip-bytes"),
      });

      const response = await request(app).get("/api/jobs/job-gen-1/download").expect(200);

      expect(response.headers["content-type"]).toContain("application/zip");
      expect(response.headers["content-disposition"]).toBe(
        "attachment; filename=Test Env-infrastructure.zip",
      );
      // supertest does not parse non-JSON bodies into res.body; the raw stream
      // is available as res.text.
      expect(response.text).toBe("mock-zip-bytes");
    });

    it("returns 404 when the job has no stored artifact", async () => {
      jobService.getJobByIdAndUser.mockResolvedValue({
        id: "job-gen-1",
        type: "generate",
        status: "succeeded",
        payload: { environment: { name: "Test Env" } },
        artifact: null,
      });

      const response = await request(app).get("/api/jobs/job-gen-1/download").expect(404);

      expect(response.body.error).toBe("Generated artifact not found");
    });
  });
});
