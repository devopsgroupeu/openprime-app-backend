// src/services/jobProcessor.js
// In-process job worker for generate/push (P1 architecture task).
//
// Polls the DB-backed queue (jobService.claimNextJob uses SELECT ... FOR
// UPDATE SKIP LOCKED), enforces concurrency caps that protect the shared
// services (Injecto, StateCraft, Bedrock all run in/behind this process),
// executes jobs, and retries transient failures with backoff.
//
// Started by server.js unless WORKER_ENABLED=false (or by src/worker.js in the
// dedicated worker Deployment). stopWorker() drains in-flight jobs and
// requeues only THIS worker's still-running jobs (claimed_by = workerId) on
// graceful shutdown, so a restart never double-processes another worker's jobs.
const { randomUUID } = require("crypto");
const { logger } = require("../utils/logger");
const jobService = require("./jobService");
const environmentService = require("./environmentService");

const POLL_INTERVAL_MS = parseInt(process.env.JOB_POLL_INTERVAL_MS || "3000", 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || "2", 10);
const MAX_CONCURRENT_GENERATE = parseInt(process.env.MAX_CONCURRENT_GENERATE || "2", 10);
const MAX_CONCURRENT_PUSH = parseInt(process.env.MAX_CONCURRENT_PUSH || "1", 10);
const JOB_DEADLINE_MS = parseInt(process.env.JOB_DEADLINE_MS || "600000", 10);
const DRAIN_TIMEOUT_MS = parseInt(process.env.JOB_DRAIN_TIMEOUT_MS || "30000", 10);

let stopping = false;
let loopPromise = null;
let expiryTimer = null;
const inFlight = new Set();
const runningCount = { total: 0, generate: 0, push: 0 };

// Stable per-process lease owner id: stamped on every claimed job so a
// graceful shutdown only requeues jobs this process claimed.
const workerId = randomUUID();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Transient failures (network, timeouts, 5xx) are retried; permanent ones
 * (auth, missing repo, bad input) fail fast so we don't burn attempts.
 */
function isRetryable(error) {
  const message = `${error?.message || ""} ${error?.code || ""}`;
  if (
    /permission denied|authentication failed|not authorized|repository not found|does not exist|host key verification|invalid/i.test(
      message,
    )
  ) {
    return false;
  }
  if (/ECONNABORTED|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|ECONNRESET/.test(message)) {
    return true;
  }
  if (error?.response?.status >= 500) return true;
  if (error?.response?.status >= 400 && error?.response?.status < 500) return false;
  if (
    /failed to connect|could not resolve host|remote end hung up|connection timed out|early eof|unable to access/i.test(
      message,
    )
  ) {
    return true;
  }
  return false;
}

async function executeJob(job) {
  const startedAt = Date.now();
  try {
    // Deadline check: fail immediately if the job expired while queued.
    if (job.deadline && Date.now() > new Date(job.deadline).getTime()) {
      throw new Error(
        `Job deadline exceeded (deadline was ${new Date(job.deadline).toISOString()})`,
      );
    }

    const environment = job.payload?.environment;
    if (!environment) {
      throw new Error("Job payload is missing the environment snapshot");
    }

    let result;
    if (job.type === "generate") {
      const zipBuffer = await environmentService.generateInfrastructure(environment);
      const downloadUrl = await jobService.persistGeneratedZip(job, zipBuffer);
      result = {
        message: "Infrastructure generated successfully",
        downloadUrl,
        sizeBytes: zipBuffer.length,
      };
    } else if (job.type === "push") {
      const zipBuffer = await environmentService.generateInfrastructure(environment);
      // The payload snapshot's git_repository is redacted (the deploy key never
      // leaves the process), so fetch the decrypted repo config at execution
      // time, user-scoped, and hand that to the push.
      const gitRepository = await environmentService.getGitRepositoryForPush(
        environment.id,
        environment.user_id,
      );
      const pushResult = await environmentService.pushInfrastructure(zipBuffer, gitRepository);
      result = {
        message: pushResult.message,
        commit: pushResult.commit || null,
        upToDate: pushResult.upToDate || false,
      };
    } else {
      throw new Error(`Unknown job type: ${job.type}`);
    }

    await jobService.markSucceeded(job, result);
  } catch (error) {
    logger.error("Job execution failed", { jobId: job.id, type: job.type, error: error.message });
    // A 422 generation failure (OP-214) is the user's problem to act on, not a
    // transient fault: never retry it, and surface the code/details the UI can
    // show alongside the message.
    if (error.statusCode === 422) {
      const details = Array.isArray(error.details) ? error.details.join("; ") : "";
      error.message = `${error.message}${error.code ? ` (${error.code})` : ""}${details ? ` ${details}` : ""}`;
      await jobService.markFailed(job, error);
    } else if (isRetryable(error) && job.attempts < job.max_attempts) {
      await jobService.markForRetry(job, error);
    } else {
      await jobService.markFailed(job, error);
    }
  }
}

async function workerLoop() {
  while (!stopping) {
    try {
      // Per-type concurrency caps protect Injecto/StateCraft/Bedrock from
      // being saturated by generate/push work.
      const claimableTypes = [];
      if (runningCount.generate < MAX_CONCURRENT_GENERATE) claimableTypes.push("generate");
      if (runningCount.push < MAX_CONCURRENT_PUSH) claimableTypes.push("push");

      if (runningCount.total >= MAX_CONCURRENT_JOBS || claimableTypes.length === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const job = await jobService.claimNextJob(claimableTypes, workerId);
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      runningCount.total += 1;
      runningCount[job.type] += 1;
      const promise = executeJob(job).finally(() => {
        runningCount.total -= 1;
        runningCount[job.type] -= 1;
        inFlight.delete(promise);
      });
      inFlight.add(promise);
    } catch (error) {
      logger.error("Worker loop error", { error: error.message });
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function startWorker() {
  if (loopPromise) return;
  // Startup recovery sweep: reclaim jobs a prior (now-dead) worker left
  // running (SIGKILL/OOM/node failure never runs stopWorker). Runs once —
  // startWorker is idempotent, so this only executes on the first call. Safe
  // because the worker Deployment uses the Recreate strategy (no sibling
  // worker can be alive to own those jobs).
  const recovered = await jobService.recoverStaleJobs(workerId);
  if (recovered > 0) {
    logger.warn("Reclaimed stale jobs left by a dead worker", { recovered });
  }
  logger.info("Job worker started", {
    pollIntervalMs: POLL_INTERVAL_MS,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    maxConcurrentGenerate: MAX_CONCURRENT_GENERATE,
    maxConcurrentPush: MAX_CONCURRENT_PUSH,
    jobDeadlineMs: JOB_DEADLINE_MS,
  });
  loopPromise = workerLoop();

  // Periodic sweep: fail jobs past their deadline every 60s. This catches
  // expired jobs that were never claimed (e.g. because the worker was down).
  expiryTimer = setInterval(async () => {
    try {
      const failed = await jobService.failExpiredJobs();
      if (failed > 0) {
        logger.warn("Periodic sweep failed expired jobs", { count: failed });
      }
      // Also clean up old terminal jobs to prevent unbounded table growth.
      const cleaned = await jobService.cleanupOldJobs();
      if (cleaned > 0) {
        logger.info("Periodic sweep cleaned up old jobs", { count: cleaned });
      }
    } catch (err) {
      logger.error("Expired job sweep failed", { error: err.message });
    }
  }, 60_000);
}

async function stopWorker() {
  if (!loopPromise) return;
  stopping = true;
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
  logger.info("Job worker stopping, draining in-flight jobs");
  await Promise.race([Promise.allSettled([...inFlight]), sleep(DRAIN_TIMEOUT_MS)]);
  const requeued = await jobService.requeueRunningJobs(workerId);
  logger.info("Job worker stopped", { requeued });
}

module.exports = { startWorker, stopWorker, isRetryable };
