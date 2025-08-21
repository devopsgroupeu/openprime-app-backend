// src/routes/environments.js
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const environmentController = require('../controllers/environmentController');
const { validateEnvironment } = require('../validators/environmentValidator');

// Get all environments
router.get('/', environmentController.getAllEnvironments);

// Get specific environment
router.get('/:id', environmentController.getEnvironment);

// Create new environment
router.post('/', 
  validateEnvironment,
  environmentController.createEnvironment
);

// Update environment
router.put('/:id',
  validateEnvironment,
  environmentController.updateEnvironment
);

// Delete environment
router.delete('/:id', environmentController.deleteEnvironment);

// Deploy environment
router.post('/:id/deploy', environmentController.deployEnvironment);

// Get environment status
router.get('/:id/status', environmentController.getEnvironmentStatus);

// Export environment as IaC
router.get('/:id/export', environmentController.exportEnvironment);

module.exports = router;
