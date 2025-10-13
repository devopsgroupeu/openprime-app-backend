// src/controllers/environmentController.js
const { validationResult } = require('express-validator');
const environmentService = require('../services/environmentService');
const userService = require('../services/userService');
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
