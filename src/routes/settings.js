// src/routes/settings.js
const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

// Get all settings
router.get('/', settingsController.getSettings);

// Update settings
router.put('/', settingsController.updateSettings);

// Cloud provider routes
router.get('/cloud-providers', settingsController.getCloudProviders);
router.post('/cloud-providers', settingsController.addCloudProvider);
router.put('/cloud-providers/:id', settingsController.updateCloudProvider);
router.delete('/cloud-providers/:id', settingsController.deleteCloudProvider);

// Git integration routes
router.get('/git', settingsController.getGitSettings);
router.put('/git', settingsController.updateGitSettings);

// API keys routes
router.get('/api-keys', settingsController.getApiKeys);
router.post('/api-keys', settingsController.generateApiKey);
router.delete('/api-keys/:id', settingsController.revokeApiKey);

module.exports = router;
