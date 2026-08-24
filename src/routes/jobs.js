// src/routes/jobs.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const jobController = require("../controllers/jobController");
const { authenticateToken } = require("../middleware/auth");

// Job status polling is high-frequency (every 2-5s for up to ~5 min per job).
// The general API limiter exempts /api/jobs/ (see src/server.js); this route
// gets its own generous bucket so polling never hits the 100-req/15-min cap.
const jobsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // ~5 min of 2s polls × multiple concurrent jobs per user
  message: "Too many job polling requests, please try again later.",
});

router.use(jobsLimiter);

router.get("/:jobId", authenticateToken, jobController.getJob);

router.get("/:jobId/download", authenticateToken, jobController.downloadJobArtifact);

module.exports = router;
