// src/routes/deployments.js
const express = require('express');
const router = express.Router();
const deploymentController = require('../controllers/deploymentController');

// Get all deployments
router.get('/', deploymentController.getAllDeployments);

// Get deployment details
router.get('/:id', deploymentController.getDeployment);

// Create new deployment
router.post('/', deploymentController.createDeployment);

// Get deployment logs
router.get('/:id/logs', deploymentController.getDeploymentLogs);

// Rollback deployment
router.post('/:id/rollback', deploymentController.rollbackDeployment);

// Get deployment metrics
router.get('/:id/metrics', deploymentController.getDeploymentMetrics);

module.exports = router;