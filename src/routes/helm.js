// src/routes/helm.js
const express = require('express');
const router = express.Router();
const helmController = require('../controllers/helmController');
const multer = require('multer');
const upload = multer({ dest: 'uploads/helm/' });

// Get available helm charts
router.get('/charts', helmController.getAvailableCharts);

// Get chart details
router.get('/charts/:chartName', helmController.getChartDetails);

// Get default values for a chart
router.get('/charts/:chartName/values', helmController.getDefaultValues);

// Validate helm values
router.post('/charts/:chartName/validate', helmController.validateValues);

// Upload custom values file
router.post('/charts/:chartName/values', 
  upload.single('values'),
  helmController.uploadValues
);

// Generate helm values from configuration
router.post('/generate-values', helmController.generateValues);

module.exports = router;
