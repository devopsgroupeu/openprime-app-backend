// src/routes/jobs.js
const express = require("express");
const router = express.Router();
const jobController = require("../controllers/jobController");
const { authenticateToken } = require("../middleware/auth");

// Job polling + artifact download for the async generate/push job model.
router.get("/:jobId", authenticateToken, jobController.getJob);

router.get("/:jobId/download", authenticateToken, jobController.downloadJobArtifact);

module.exports = router;
