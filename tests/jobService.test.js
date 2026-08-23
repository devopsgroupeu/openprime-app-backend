// tests/jobService.test.js
// Unit tests for the DB-backed job queue: enqueue dedupe/idempotency/per-repo
// lock, claim, and outcome persistence. Uses the REAL jobService with the
// mocked models from tests/setup.js.
jest.unmock("../src/services/jobService");

const { Op } = require("sequelize");
const jobService = require("../src/services/jobService");
const { sequelize, Job, Environment } = require("../src/models");

const mockEnvironment = {
  id: "env-1",
  name: "Test Env",
  global_prefix: "op-",
  provider: "aws",
  region: "us-east-1",
  status: "pending",
  services: {},
  terraform_backend: null,
  git_repository: {
    enabled: true,
    url: "git@github.com:test-org/infra-repo.git",
    branch: "main",
    sshKey: "ssh-key",
  },
  user_id: 1,
};

describe("jobService.enqueue", () => {
  beforeEach(() => {
    // resetAllMocks: also clears mockResolvedValueOnce queues left over from
    // the previous test (clearAllMocks only clears call history).
    jest.resetAllMocks();
  });

  it("creates a queued generate job with an environment snapshot payload", async () => {
    Job.findOne.mockResolvedValue(null);
    Job.create.mockResolvedValue({ id: "job-1", type: "generate", status: "queued" });

    const job = await jobService.enqueue("generate", mockEnvironment, { userId: 1 });

    expect(job.id).toBe("job-1");
    expect(Job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "generate",
        status: "queued",
        environment_id: "env-1",
        user_id: 1,
        repo_url: null,
        branch: null,
        attempts: 0,
        max_attempts: 3,
      }),
    );
    const createArgs = Job.create.mock.calls[0][0];
    expect(createArgs.payload.environment).toEqual(mockEnvironment);
  });

  it("returns the existing job when the idempotency key was already used", async () => {
    const existing = { id: "job-1", type: "generate", status: "succeeded" };
    Job.findOne.mockResolvedValueOnce(existing);

    const job = await jobService.enqueue("generate", mockEnvironment, {
      idempotencyKey: "key-123",
      userId: 1,
    });

    expect(job).toBe(existing);
    expect(Job.create).not.toHaveBeenCalled();
  });

  it("dedupes: returns the active job of the same type for the same environment", async () => {
    const active = { id: "job-2", type: "generate", status: "running" };
    // No idempotency key → the only findOne is the dedupe check.
    Job.findOne.mockResolvedValue(active);

    const job = await jobService.enqueue("generate", mockEnvironment, { userId: 1 });

    expect(job).toBe(active);
    expect(Job.create).not.toHaveBeenCalled();
  });

  it("throws JobConflictError (409) when another environment holds the per-repo lock", async () => {
    Job.findOne.mockResolvedValueOnce(null); // dedupe (no active job for env-1)
    Job.findOne.mockResolvedValueOnce({
      id: "job-3",
      type: "push",
      environment_id: "env-other",
      status: "running",
    }); // repo lock held by another environment

    await expect(jobService.enqueue("push", mockEnvironment, { userId: 1 })).rejects.toMatchObject({
      name: "JobConflictError",
      status: 409,
      message: "Another push to this repository is already in progress",
    });
    expect(Job.create).not.toHaveBeenCalled();
  });

  it("stores repo_url and branch on push jobs for the per-repo lock", async () => {
    Job.findOne.mockResolvedValue(null);
    Job.create.mockResolvedValue({ id: "job-4", type: "push", status: "queued" });

    await jobService.enqueue("push", mockEnvironment, { userId: 1 });

    expect(Job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "push",
        repo_url: "git@github.com:test-org/infra-repo.git",
        branch: "main",
      }),
    );
  });
});

describe("jobService.claimNextJob", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // resetAllMocks also wipes the setup.js transaction mock — restore it.
    sequelize.transaction.mockResolvedValue({
      LOCK: { UPDATE: "UPDATE" },
      commit: jest.fn().mockResolvedValue(true),
      rollback: jest.fn().mockResolvedValue(true),
    });
  });

  it("claims the oldest due job, marks it running and increments attempts", async () => {
    const job = {
      id: "job-1",
      type: "generate",
      environment_id: "env-1",
      attempts: 0,
      update: jest.fn().mockResolvedValue(true),
    };
    Job.findOne.mockResolvedValue(job);
    Environment.update.mockResolvedValue([1]);

    const claimed = await jobService.claimNextJob(["generate"], "worker-1");

    expect(claimed).toBe(job);
    expect(job.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "running", attempts: 1 }),
      expect.anything(),
    );
    // environment.status → deploying while the job runs
    expect(Environment.update).toHaveBeenCalledWith(
      { status: "deploying" },
      { where: { id: "env-1" } },
    );
  });

  it("stamps claimed_by with the worker id (lease owner)", async () => {
    const job = {
      id: "job-1",
      type: "generate",
      environment_id: "env-1",
      attempts: 0,
      update: jest.fn().mockResolvedValue(true),
    };
    Job.findOne.mockResolvedValue(job);
    Environment.update.mockResolvedValue([1]);

    await jobService.claimNextJob(["generate"], "worker-1");

    expect(job.update).toHaveBeenCalledWith(
      expect.objectContaining({ claimed_by: "worker-1" }),
      expect.anything(),
    );
  });

  it("does not stamp claimed_by when no worker id is provided", async () => {
    const job = {
      id: "job-1",
      type: "generate",
      environment_id: "env-1",
      attempts: 0,
      update: jest.fn().mockResolvedValue(true),
    };
    Job.findOne.mockResolvedValue(job);
    Environment.update.mockResolvedValue([1]);

    await jobService.claimNextJob(["generate"]);

    expect(job.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ claimed_by: expect.anything() }),
      expect.anything(),
    );
  });

  it("returns null when no job is due", async () => {
    Job.findOne.mockResolvedValue(null);

    const claimed = await jobService.claimNextJob(["generate"], "worker-1");

    expect(claimed).toBeNull();
  });
});

describe("jobService.requeueRunningJobs", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("requeues only the caller's own running jobs (claimed_by = workerId)", async () => {
    const myJob = {
      id: "job-1",
      type: "generate",
      update: jest.fn().mockResolvedValue(true),
    };
    Job.findAll.mockResolvedValue([myJob]);

    const count = await jobService.requeueRunningJobs("worker-1");

    expect(Job.findAll).toHaveBeenCalledWith({
      where: { status: "running", claimed_by: "worker-1" },
    });
    expect(myJob.update).toHaveBeenCalledWith(expect.objectContaining({ status: "queued" }));
    expect(count).toBe(1);
  });

  it("returns 0 and requeues nothing when no jobs are claimed by this worker", async () => {
    Job.findAll.mockResolvedValue([]);

    const count = await jobService.requeueRunningJobs("worker-1");

    expect(Job.findAll).toHaveBeenCalledWith({
      where: { status: "running", claimed_by: "worker-1" },
    });
    expect(count).toBe(0);
  });
});

describe("jobService.persistGeneratedZip", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("stores the ZIP buffer on the job row and returns the download URL", async () => {
    const job = {
      id: "job-1",
      update: jest.fn().mockResolvedValue(true),
    };
    const zipBuffer = Buffer.from("zip-bytes");

    const downloadUrl = await jobService.persistGeneratedZip(job, zipBuffer);

    expect(job.update).toHaveBeenCalledWith({ artifact: zipBuffer });
    expect(downloadUrl).toBe("/jobs/job-1/download");
  });
});

describe("jobService.recoverStaleJobs", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("reclaims running jobs claimed by a dead worker (claimed_by != workerId)", async () => {
    const staleJob = {
      id: "job-1",
      type: "generate",
      claimed_by: "dead-worker-uuid",
      update: jest.fn().mockResolvedValue(true),
    };
    Job.findAll.mockResolvedValue([staleJob]);

    const count = await jobService.recoverStaleJobs("my-worker-uuid");

    expect(Job.findAll).toHaveBeenCalledWith({
      where: { status: "running", claimed_by: { [Op.ne]: "my-worker-uuid" } },
    });
    expect(staleJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "queued", claimed_by: null }),
    );
    const updateArgs = staleJob.update.mock.calls[0][0];
    expect(updateArgs.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    expect(count).toBe(1);
  });

  it("does not touch a job already claimed by this worker (claimed_by === workerId)", async () => {
    // The where clause excludes this worker's own claims, so a job with
    // claimed_by === workerId is never selected and never updated.
    Job.findAll.mockResolvedValue([]);

    const count = await jobService.recoverStaleJobs("my-worker-uuid");

    expect(Job.findAll).toHaveBeenCalledWith({
      where: { status: "running", claimed_by: { [Op.ne]: "my-worker-uuid" } },
    });
    expect(count).toBe(0);
  });

  it("does not touch non-running jobs", async () => {
    // Only status=running rows are selected; queued/succeeded/failed jobs are
    // never returned by the query, so nothing is updated.
    Job.findAll.mockResolvedValue([]);

    const count = await jobService.recoverStaleJobs("my-worker-uuid");

    expect(Job.findAll).toHaveBeenCalledWith({
      where: { status: "running", claimed_by: { [Op.ne]: "my-worker-uuid" } },
    });
    expect(count).toBe(0);
  });
});

describe("jobService outcome persistence", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("markSucceeded persists last_push_* and sets environment status to running", async () => {
    const job = {
      id: "job-1",
      type: "push",
      environment_id: "env-1",
      update: jest.fn().mockResolvedValue(true),
    };
    Environment.update.mockResolvedValue([1]);

    await jobService.markSucceeded(job, {
      message: "Infrastructure pushed to Git",
      commit: "abc123",
    });

    expect(job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        result: { message: "Infrastructure pushed to Git", commit: "abc123" },
      }),
    );
    const outcomeCall = Environment.update.mock.calls.find(
      ([update]) => update.last_push_at !== undefined,
    );
    expect(outcomeCall[0]).toMatchObject({
      last_push_status: "succeeded",
      last_push_commit: "abc123",
      last_push_error: null,
    });
    expect(Environment.update).toHaveBeenCalledWith(
      { status: "running" },
      { where: { id: "env-1" } },
    );
  });

  it("markFailed persists last_generate_error and sets environment status to failed", async () => {
    const job = {
      id: "job-2",
      type: "generate",
      environment_id: "env-1",
      update: jest.fn().mockResolvedValue(true),
    };
    Environment.update.mockResolvedValue([1]);

    await jobService.markFailed(job, new Error("Injecto service call failed"));

    expect(job.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "Injecto service call failed" }),
    );
    const outcomeCall = Environment.update.mock.calls.find(
      ([update]) => update.last_generate_at !== undefined,
    );
    expect(outcomeCall[0]).toMatchObject({
      last_generate_status: "failed",
      last_generate_error: "Injecto service call failed",
    });
    expect(Environment.update).toHaveBeenCalledWith(
      { status: "failed" },
      { where: { id: "env-1" } },
    );
  });

  it("markForRetry requeues with exponential backoff", async () => {
    const job = {
      id: "job-3",
      type: "push",
      attempts: 2,
      max_attempts: 3,
      update: jest.fn().mockResolvedValue(true),
    };

    await jobService.markForRetry(job, new Error("connection timed out"));

    expect(job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "queued",
        error: "connection timed out",
      }),
    );
    const updateArgs = job.update.mock.calls[0][0];
    expect(updateArgs.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });
});
