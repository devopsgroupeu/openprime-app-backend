const express = require('express');
const { body, param, query } = require('express-validator');
const cloudCredentialController = require('../controllers/cloudCredentialController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/',
  authenticateToken,
  [
    body('provider').isIn(['aws', 'azure', 'gcp', 'onpremise']).withMessage('Invalid provider'),
    body('name').isString().trim().notEmpty().withMessage('Name is required'),
    body('identifier').isString().trim().notEmpty().withMessage('Identifier is required'),
    body('credentials').isObject().withMessage('Credentials must be an object'),
    body('isDefault').optional().isBoolean().withMessage('isDefault must be boolean')
  ],
  cloudCredentialController.createCredential
);

router.get('/',
  authenticateToken,
  [
    query('provider').optional().isIn(['aws', 'azure', 'gcp', 'onpremise']).withMessage('Invalid provider')
  ],
  cloudCredentialController.getCredentials
);

router.get('/:credentialId',
  authenticateToken,
  [
    param('credentialId').isUUID().withMessage('Invalid credential ID')
  ],
  cloudCredentialController.getCredentialById
);

router.put('/:credentialId',
  authenticateToken,
  [
    param('credentialId').isUUID().withMessage('Invalid credential ID'),
    body('name').optional().isString().trim().notEmpty().withMessage('Name must be non-empty'),
    body('identifier').optional().isString().trim().notEmpty().withMessage('Identifier must be non-empty'),
    body('credentials').optional().isObject().withMessage('Credentials must be an object'),
    body('isDefault').optional().isBoolean().withMessage('isDefault must be boolean')
  ],
  cloudCredentialController.updateCredential
);

router.delete('/:credentialId',
  authenticateToken,
  [
    param('credentialId').isUUID().withMessage('Invalid credential ID')
  ],
  cloudCredentialController.deleteCredential
);

router.put('/:credentialId/default',
  authenticateToken,
  [
    param('credentialId').isUUID().withMessage('Invalid credential ID')
  ],
  cloudCredentialController.setDefaultCredential
);

module.exports = router;
