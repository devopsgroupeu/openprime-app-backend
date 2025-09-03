const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authenticateToken, userController.getCurrentUser);

router.put('/me/profile', 
  authenticateToken,
  [
    body('firstName').optional().isLength({ min: 1, max: 100 }).trim(),
    body('lastName').optional().isLength({ min: 1, max: 100 }).trim(),
    body('email').optional().isEmail().normalizeEmail()
  ],
  userController.updateProfile
);

router.get('/me/preferences', authenticateToken, userController.getPreferences);

router.put('/me/preferences',
  authenticateToken,
  [
    body('theme').optional().isIn(['light', 'dark']),
    body('notifications').optional().isBoolean(),
    body('defaultProvider').optional().isIn(['aws', 'azure', 'gcp', 'onpremise']),
    body('defaultRegion').optional().isString().trim()
  ],
  userController.updatePreferences
);

router.get('/', 
  authenticateToken, 
  requireRole('admin'), 
  userController.getAllUsers
);

router.put('/:userId/deactivate', 
  authenticateToken, 
  requireRole('admin'), 
  userController.deactivateUser
);

module.exports = router;