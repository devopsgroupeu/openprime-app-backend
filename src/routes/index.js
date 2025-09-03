// src/routes/index.js
const express = require('express');
const router = express.Router();

const environmentRoutes = require('./environments');
const templateRoutes = require('./templates');
const helmRoutes = require('./helm');
const terraformRoutes = require('./terraform');
const settingsRoutes = require('./settings');
const deploymentRoutes = require('./deployments');
const aiRoutes = require('./ai');

router.use('/environments', environmentRoutes);
router.use('/templates', templateRoutes);
router.use('/helm', helmRoutes);
router.use('/terraform', terraformRoutes);
router.use('/settings', settingsRoutes);
router.use('/deployments', deploymentRoutes);
router.use('/ai', aiRoutes);


module.exports = router;
