// src/services/jobService.js
// DB-backed job queue for generate/push (P1 architecture task).
//
// The API enqueues a row and returns 202 + jobId; the in-process worker
// (src/services/jobProcessor.js) claims rows with SELECT ... FOR UPDATE
// SKIP LOCKED; the UI polls GET /api/jobs/:jobId.
//
// Concurrency controls:
//   - idempotency_key UNIQUE  -> replaying a request returns the same job
//   - jobs_active_env_lock    -> one active job per (type, environment_id)
//   - jobs_active_repo_lock   -> one active push per (repo_url, branch) across
//                                all environments (concurrent pushes can
//                                corrupt a repo)
const { Op } = require("sequelize");
const fs = require("node:fs");
const path = require("node:path");
const { sequelize, Job, Environment } = require("../models");
const { logger } = require("../utils/logger");

const JOB_MAX_ATTEMPTS = parseInt(process.env.JOB_MAX_ATTEMPTS || "3", 10);
const RETRY_BASE_DELAY_MS = parseInt(process.env.JOB_RETRY_BASE_DELAY_MS || "5000", 10);
const RETRY_MAX_DELAY_MS = parseInt(process.env.JOB_RETRY_MAX_DELAY_MS || "300000", 10);

// Thrown when a request cannot be enqueued because another job holds the
// per-repo lock. Carries HTTP 409 so the error handler maps it correctly.
class JobConflictError extends Error {
  constructor(message) {
    super(message);
    this.status = 409;
    this.name = "JobConflictError";
  }
}

class JobService {
  /**
   * Enqueue a generate/push job for an environment.
   * Returns the created job, or an existing one when:
   *   - the same idempotency key was already used, or
   *   - an active (queued/running) job of the same type exists for this env.
   * Throws JobConflictError (409) when another environment holds the per-repo
   * lock for the same repo+branch.
   */
  async enqueue(type, environment, { idempotencyKey = null, userId = null } = {}) {
    const repoUrl = type === "push" ? environment.git_repository?.url || null : null;
    const branch = type === "push" ? environment.git_repository?.branch || "HEAD" : null;

    // 1. Idempotency key replay — same key always returns the same job.
    if (idempotencyKey) {
      const existing = await Job.findOne({ where: { idempotency_key: idempotencyKey } });
      if (existing) {
        logger.info("Reusing job for idempotency key", {
          jobId: existing.id,
          idempotencyKey,
        });
        return existing;
      }
    }

    // 2. Dedupe: an active job of the same type for this environment.
    const active = await this.findActiveJob(type, environment.id);
    if (active) {
      logger.info("Reusing active job for environment", {
        jobId: active.id,
        type,
        environmentId: environment.id,
      });
      return active;
    }

    // 3. Per-repo lock (push only): another environment pushing to the same
    //    repo+branch would race on clone/commit/push — reject it.
    if (type === "push" && repoUrl) {
      const repoJob = await Job.findOne({
        where: {
          type: "push",
          repo_url: repoUrl,
          branch,
          status: { [Op.in]: ["queued", "running"] },
        },
      });
      if (repoJob && repoJob.environment_id !== environment.id) {
        throw new JobConflictError("Another push to this repository is already in progress");
      }
    }

    const payload = { environment };

    try {
      const job = await Job.create({
        type,
        status: "queued",
        environment_id: environment.id,
        user_id: userId || environment.user_id || null,
        payload,
        idempotency_key: idempotencyKey,
        repo_url: repoUrl,
        branch,
        attempts: 0,
        max_attempts: JOB_MAX_ATTEMPTS,
        next_attempt_at: null,
      });
      logger.info("Job enqueued", { jobId: job.id, type, environmentId: environment.id });
      return job;
    } catch (error) {
      // Race: two enqueues passed the pre-checks; the DB unique index
      // (jobs_active_env_lock / jobs_active_repo_lock) rejected one of them.
      if (error.name === "SequelizeUniqueConstraintError") {
        const winner = await this.findActiveJob(type, environment.id);
        if (winner) {
          logger.info("Reusing job created by concurrent request", { jobId: winner.id });
          return winner;
        }
        throw new JobConflictError("Another push to this repository is already in progress");
      }
      throw error;
    }
  }

  async findActiveJob(type, environmentId) {
    return Job.findOne({
      where: {
        type,
        environment_id: environmentId,
        status: { [Op.in]: ["queued", "running"] },
      },
    });
  }

  /**
   * Claim the oldest due queued job (SELECT ... FOR UPDATE SKIP LOCKED).
   * `types` optionally restricts which job types may be claimed (used by the
   * worker to enforce per-type concurrency caps). Returns the job with
   * status=running and attempts incremented, or null when nothing is due.
   */
  async claimNextJob(types = null) {
    const transaction = await sequelize.transaction();
    try {
      const where = {
        status: "queued",
        next_attempt_at: { [Op.or]: [null, { [Op.lte]: new Date() }] },
      };
      if (types && types.length === 1) {
        where.type = types[0];
      }

      const job = await Job.findOne({
        where,
        order: [["created_at", "ASC"]],
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
        transaction,
      });

      if (!job) {
        await transaction.commit();
        return null;
      }

      await job.update(
        {
          status: "running",
          started_at: new Date(),
          attempts: job.attempts + 1,
          next_attempt_at: null,
        },
        { transaction },
      );
      await transaction.commit();

      await this.updateEnvironmentStatus(job.environment_id, "deploying");
      logger.info("Job claimed", { jobId: job.id, type: job.type, attempts: job.attempts });
      return job;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getJobByIdAndUser(jobId, userId) {
    return Job.findOne({ where: { id: jobId, user_id: userId } });
  }

  async markSucceeded(job, result) {
    await job.update({
      status: "succeeded",
      result,
      error: null,
      finished_at: new Date(),
    });
    await this.persistOutcome(job, "succeeded", result);
    await this.updateEnvironmentStatus(job.environment_id, "running");
    logger.info("Job succeeded", { jobId: job.id, type: job.type });
  }

  async markFailed(job, error) {
    const message = error?.message || String(error);
    await job.update({
      status: "failed",
      error: message,
      finished_at: new Date(),
    });
    await this.persistOutcome(job, "failed", message);
    await this.updateEnvironmentStatus(job.environment_id, "failed");
    logger.error("Job failed permanently", { jobId: job.id, type: job.type, error: message });
  }

  /** Requeue a failed job with exponential backoff (attempts already incremented at claim). */
  async markForRetry(job, error) {
    const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (job.attempts - 1), RETRY_MAX_DELAY_MS);
    const nextAttemptAt = new Date(Date.now() + delay);
    await job.update({
      status: "queued",
      error: error?.message || String(error),
      next_attempt_at: nextAttemptAt,
    });
    logger.warn("Job scheduled for retry", {
      jobId: job.id,
      type: job.type,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      nextAttemptAt: nextAttemptAt.toISOString(),
      error: error?.message,
    });
  }

  /** Requeue any job still running (graceful shutdown drain). */
  async requeueRunningJobs() {
    const running = await Job.findAll({ where: { status: "running" } });
    for (const job of running) {
      await job.update({
        status: "queued",
        next_attempt_at: new Date(Date.now() + RETRY_BASE_DELAY_MS),
      });
      logger.warn("Requeued in-flight job during shutdown", { jobId: job.id, type: job.type });
    }
    return running.length;
  }

  /** Persist the last-generate/last-push outcome on the environment. */
  async persistOutcome(job, status, resultOrError) {
    const isGenerate = job.type === "generate";
    const now = new Date();
    const update = isGenerate
      ? {
          last_generate_at: now,
          last_generate_status: status,
          last_generate_error: status === "failed" ? String(resultOrError) : null,
        }
      : {
          last_push_at: now,
          last_push_status: status,
          last_push_error: status === "failed" ? String(resultOrError) : null,
          last_push_commit: status === "succeeded" ? resultOrError?.commit || null : null,
        };
    await Environment.update(update, { where: { id: job.environment_id } });
  }

  async updateEnvironmentStatus(environmentId, status) {
    await Environment.update({ status }, { where: { id: environmentId } });
  }

  /** Write the generated ZIP to disk (uploads/generated/<jobId>/infrastructure.zip). */
  async persistGeneratedZip(jobId, zipBuffer) {
    const dir = path.join(process.env.UPLOADS_DIR || "uploads", "generated", jobId);
    await fs.promises.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "infrastructure.zip");
    await fs.promises.writeFile(filePath, zipBuffer);
    return `/jobs/${jobId}/download`;
  }

  getGeneratedZipPath(jobId) {
    return path.join(
      process.env.UPLOADS_DIR || "uploads",
      "generated",
      jobId,
      "infrastructure.zip",
    );
  }
}

module.exports = new JobService();
module.exports.JobConflictError = JobConflictError;
