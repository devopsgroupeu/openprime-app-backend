// src/routes/index.js
const express = require("express");
const router = express.Router();

const environmentRoutes = require("./environments");
const userRoutes = require("./users");
const aiRoutes = require("./ai");
const cloudCredentialsRoutes = require("./cloudCredentials");
const jobRoutes = require("./jobs");
const catalogRoutes = require("./catalog");

router.use("/ai", aiRoutes);
router.use("/environments", environmentRoutes);
router.use("/users", userRoutes);
router.use("/cloud-credentials", cloudCredentialsRoutes);
router.use("/jobs", jobRoutes);
router.use("/catalog", catalogRoutes);

module.exports = router;
