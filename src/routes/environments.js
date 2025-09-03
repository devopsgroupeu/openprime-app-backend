// src/routes/environments.js
const express = require('express');
const router = express.Router();
const environmentController = require('../controllers/environmentController');
const { validateEnvironment } = require('../validators/environmentValidator');
const { authenticateToken } = require('../middleware/auth');

router.get('/', authenticateToken, environmentController.getUserEnvironments);

router.get('/:id', authenticateToken, environmentController.getEnvironment);

router.post('/', 
  authenticateToken,
  validateEnvironment,
  environmentController.createEnvironment
);

router.put('/:id',
  authenticateToken,
  validateEnvironment,
  environmentController.updateEnvironment
);

router.delete('/:id', authenticateToken, environmentController.deleteEnvironment);

module.exports = router;
