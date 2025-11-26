// src/controllers/environmentController.js
const { validationResult } = require('express-validator');
const environmentService = require('../services/environmentService');
const userService = require('../services/userService');
const statecraftService = require('../services/statecraftService');
const cloudCredentialService = require('../services/cloudCredentialService');

exports.getUserEnvironments = async (req, res, next) => {
  try {
    let user = await userService.getUserByKeycloakId(req.user.id);
    if (!user) {
      user = await userService.findOrCreateUser(req.user);
    }

    const environments = await environmentService.getUserEnvironments(user.id);
    res.json(environments);
  } catch (error) {
    req.log.error('Failed to get user environments', { error: error.message });
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
    req.log.error('Failed to get environment', { environmentId: req.params.id, error: error.message });
    next(error);
  }
};

exports.createEnvironment = async (req, res, next) => {
  try {
    req.log.debug('Environment creation request', { body: req.body });
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      req.log.warn('Validation failed', { errors: errors.array() });
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

    req.log.info('Creating environment', { userId: user.id, username: user.username });

    // Convert to YAML format for logging/processing
    const yamlData = await environmentService.convertToYAML(environmentData);
    req.log.debug('Environment YAML generated', { yaml: yamlData });

    // Save environment with original data
    const environment = await environmentService.createEnvironment(environmentData);

    req.log.info('Environment created', { environmentId: environment.id, name: environment.name });
    res.status(201).json(environment);
  } catch (error) {
    req.log.error('Failed to create environment', { error: error.message });
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

    req.log.info('Environment updated', { environmentId: id });
    res.json(environment);
  } catch (error) {
    req.log.error('Failed to update environment', { environmentId: req.params.id, error: error.message });
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

    req.log.info('Environment deleted', { environmentId: id });
    res.json({ message: 'Environment deleted successfully' });
  } catch (error) {
    req.log.error('Failed to delete environment', { environmentId: req.params.id, error: error.message });
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

    req.log.info('Generating infrastructure', { environmentId: id, name: environment.name });

    // Call Injecto service to generate infrastructure
    const zipBuffer = await environmentService.generateInfrastructure(environment);

    // Set response headers for ZIP download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=${environment.name}-infrastructure.zip`);
    res.send(zipBuffer);
  } catch (error) {
    req.log.error('Failed to generate infrastructure', { environmentId: req.params.id, error: error.message });
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
      req.log.debug('Credentials decrypted', {
        hasCredentials: !!decryptedCredentials,
        keys: decryptedCredentials ? Object.keys(decryptedCredentials) : []
      });
    } catch (error) {
      req.log.error('Failed to decrypt credentials', { credentialId: cloudCredentialId, error: error.message });
      return res.status(400).json({ error: 'Failed to decrypt cloud credentials. Please update your credentials.' });
    }

    const awsAccessKeyId = decryptedCredentials?.accessKeyId || decryptedCredentials?.accessKey;
    const awsSecretAccessKey = decryptedCredentials?.secretAccessKey || decryptedCredentials?.secretKey;

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      req.log.warn('Invalid credential structure', {
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

    req.log.debug('Generated bucket name', { bucketName, awsAccountId, sanitizedEnvName });

    const statecraftConfig = {
      region,
      bucketName,
      lockingMechanism: lockingMechanism || 's3',
      tableName,
      awsAccessKeyId,
      awsSecretAccessKey
    };

    req.log.info('Creating Terraform backend', { userId: user.id, bucketName, region });
    const result = await statecraftService.createBackendResources(statecraftConfig);

    if (!result.success) {
      req.log.error('Terraform backend creation failed', { error: result.error });
      return res.status(500).json({
        success: false,
        error: 'Failed to create Terraform backend resources',
        details: result.error
      });
    }

    req.log.info('Terraform backend created', { bucketName, region });
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
    req.log.error('Failed to create Terraform backend', { error: error.message });
    next(error);
  }
};
