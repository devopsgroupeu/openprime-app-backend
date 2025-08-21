// src/routes/terraform.js
const express = require('express');
const router = express.Router();
const terraformController = require('../controllers/terraformController');

// Generate Terraform configuration
router.post('/generate', terraformController.generateTerraform);

// Validate Terraform configuration
router.post('/validate', terraformController.validateTerraform);

// Get Terraform modules
router.get('/modules', terraformController.getModules);

// Get module details
router.get('/modules/:moduleName', terraformController.getModuleDetails);

// Plan Terraform changes
router.post('/plan', terraformController.planTerraform);

// Export Terraform configuration
router.post('/export', terraformController.exportTerraform);

module.exports = router;
