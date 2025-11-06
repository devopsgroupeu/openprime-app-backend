// src/controllers/environmentController.js
const { validationResult } = require('express-validator');
const environmentService = require('../services/environmentService');
const userService = require('../services/userService');
const statecraftService = require('../services/statecraftService');
const cloudCredentialService = require('../services/cloudCredentialService');
const { logger } = require('../utils/logger');

exports.getUserEnvironments = async (req, res, next) => {
  try {
    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const environments = await environmentService.getUserEnvironments(user.id);
    res.json(environments);
  } catch (error) {
    logger.error('Error getting user environments:', error);
    next(error);
  }
};

exports.getEnvironment = async (req, res, next) => {
  try {
    const { id } = req.params;
    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const environment = await environmentService.getEnvironmentByIdAndUser(id, user.id);
    if (!environment) {
      return res.status(404).json({ error: 'Environment not found' });
    }

    res.json(environment);
  } catch (error) {
    logger.error('Error getting environment:', error);
    next(error);
  }
};

exports.createEnvironment = async (req, res, next) => {
  try {
    logger.info('Environment creation request body:', req.body);
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.error('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const environmentData = {
      ...req.body,
      user_id: user.id
    };

    logger.info('Creating environment for user:', user.username);

    // Convert to YAML format for logging/processing
    const yamlData = await environmentService.convertToYAML(environmentData);
    logger.info('Environment YAML:', yamlData);

    // Save environment with original data
    const environment = await environmentService.createEnvironment(environmentData);

    res.status(201).json(environment);
  } catch (error) {
    logger.error('Error creating environment:', error);
    next(error);
  }
};

exports.updateEnvironment = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const environment = await environmentService.updateEnvironmentByUser(id, user.id, req.body);
    if (!environment) {
      return res.status(404).json({ error: 'Environment not found' });
    }

    res.json(environment);
  } catch (error) {
    logger.error('Error updating environment:', error);
    next(error);
  }
};

exports.deleteEnvironment = async (req, res, next) => {
  try {
    const { id } = req.params;
    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const deleted = await environmentService.deleteEnvironmentByUser(id, user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Environment not found' });
    }

    res.json({ message: 'Environment deleted successfully' });
  } catch (error) {
    logger.error('Error deleting environment:', error);
    next(error);
  }
};

exports.generateInfrastructure = async (req, res, next) => {
  try {
    const { id } = req.params;
    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const environment = await environmentService.getEnvironmentByIdAndUser(id, user.id);
    if (!environment) {
      return res.status(404).json({ error: 'Environment not found' });
    }

    logger.info(`Generating infrastructure for environment: ${id}`);

    // Call Injecto service to generate infrastructure
    const zipBuffer = await environmentService.generateInfrastructure(environment);

    // Set response headers for ZIP download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${environment.name}-infrastructure.zip`);
    res.send(zipBuffer);
  } catch (error) {
    logger.error('Error generating infrastructure:', error);
    next(error);
  }
};

exports.createTerraformBackend = async (req, res, next) => {
  try {
    const { region, environmentName, lockingMechanism, tableName, cloudCredentialId } = req.body;

    if (!region || !environmentName) {
      return res.status(400).json({ error: 'Region and environment name are required' });
    }

    if (lockingMechanism === 'dynamodb' && !tableName) {
      return res.status(400).json({ error: 'Table name is required for DynamoDB locking mechanism' });
    }

    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    if (!cloudCredentialId) {
      return res.status(400).json({ error: 'AWS credentials are required to create Terraform backend resources' });
    }

    const credential = await cloudCredentialService.getCredentialById(cloudCredentialId, user.id);
    if (!credential) {
      return res.status(404).json({ error: 'Cloud credential not found' });
    }

    let decryptedCredentials;
    try {
      decryptedCredentials = credential.credentials;
      logger.info('Decrypted credentials structure:', {
        hasCredentials: !!decryptedCredentials,
        keys: decryptedCredentials ? Object.keys(decryptedCredentials) : [],
        type: typeof decryptedCredentials
      });
    } catch (error) {
      logger.error('Failed to decrypt cloud credentials:', error);
      return res.status(400).json({ error: 'Failed to decrypt cloud credentials. Please update your credentials.' });
    }

    const awsAccessKeyId = decryptedCredentials?.accessKeyId || decryptedCredentials?.accessKey;
    const awsSecretAccessKey = decryptedCredentials?.secretAccessKey || decryptedCredentials?.secretKey;

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      logger.error('Invalid credential structure:', {
        hasCredentials: !!decryptedCredentials,
        hasAccessKeyId: !!awsAccessKeyId,
        hasSecretAccessKey: !!awsSecretAccessKey,
        availableKeys: decryptedCredentials ? Object.keys(decryptedCredentials) : []
      });
      return res.status(400).json({ error: 'Cloud credential does not contain valid AWS access keys. Please update your credentials.' });
    }

    const awsAccountId = credential.identifier;
    const sanitizedEnvName = environmentName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 40);

    const bucketName = `${awsAccountId}-terraform-${sanitizedEnvName}`;

    logger.info('Generated bucket name:', { bucketName, awsAccountId, environmentName, sanitizedEnvName });

    const statecraftConfig = {
      region,
      bucketName,
      lockingMechanism: lockingMechanism || 's3',
      tableName,
      awsAccessKeyId,
      awsSecretAccessKey
    };

    logger.info(`Creating Terraform backend resources for user ${user.username}`);
    const result = await statecraftService.createBackendResources(statecraftConfig);

    if (!result.success) {
      logger.error('Failed to create Terraform backend:', result.error);
      return res.status(500).json({
        success: false,
        error: 'Failed to create Terraform backend resources',
        details: result.error
      });
    }

    logger.info('Terraform backend resources created successfully');
    res.status(201).json({
      success: true,
      message: 'Terraform backend resources created successfully',
      data: {
        ...result.data,
        bucketName,
        region
      }
    });
  } catch (error) {
    logger.error('Error creating Terraform backend:', error);
    next(error);
  }
};
