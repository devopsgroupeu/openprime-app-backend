// src/controllers/jobController.js
const jobService = require("../services/jobService");
const userService = require("../services/userService");

// Poll endpoint: the UI calls this until the job reaches a terminal state.
exports.getJob = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const job = await jobService.getJobByIdAndUser(jobId, user.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      result: job.result,
      error: job.error,
      createdAt: job.created_at,
      startedAt: job.started_at,
      finishedAt: job.finished_at,
    });
  } catch (error) {
    req.log.error("Failed to get job", { jobId: req.params.jobId, error: error.message });
    next(error);
  }
};

// Serves the generated ZIP for a succeeded generate job.
exports.downloadJobArtifact = async (req, res, next) => {
  try {
    const { jobId } = req.params;
    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const job = await jobService.getJobByIdAndUser(jobId, user.id);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.type !== "generate") {
      return res.status(400).json({ error: "This job has no downloadable artifact" });
    }
    if (job.status !== "succeeded") {
      return res.status(409).json({ error: "Job has not completed successfully yet" });
    }

    // The artifact lives on the jobs row (BYTEA), not the filesystem, so any
    // pod can serve it regardless of which pod ran the job.
    if (!job.artifact || job.artifact.length === 0) {
      return res.status(404).json({ error: "Generated artifact not found" });
    }

    const envName = job.payload?.environment?.name || "infrastructure";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=${envName}-infrastructure.zip`);
    res.send(Buffer.from(job.artifact));
  } catch (error) {
    req.log.error("Failed to download job artifact", {
      jobId: req.params.jobId,
      error: error.message,
    });
    next(error);
  }
};
