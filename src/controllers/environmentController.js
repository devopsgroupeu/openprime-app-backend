// src/controllers/environmentController.js
const { validationResult } = require('express-validator');
const environmentService = require('../services/environmentService');
const pythonService = require('../services/pythonService');
const { logger } = require('../utils/logger');

exports.getAllEnvironments = async (req, res, next) => {
  try {
    const environments = await environmentService.getAllEnvironments();
    res.json(environments);
  } catch (error) {
    logger.error('Error fetching environments:', error);
    next(error);
  }
};

exports.getEnvironment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const environment = await environmentService.getEnvironmentById(id);
    
    if (!environment) {
      return res.status(404).json({ error: 'Environment not found' });
    }
    
    res.json(environment);
  } catch (error) {
    logger.error('Error fetching environment:', error);
    next(error);
  }
};

exports.createEnvironment = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const environmentData = req.body;

    logger.info('Creating environment with data:', environmentData);
    
    // Convert to YAML for Python processing
    const yamlData = await environmentService.convertToYAML(environmentData);
    
    // Call Python service to process the configuration
    // const processedData = await pythonService.processEnvironmentConfig(yamlData);
    const processedData = yamlData;
    
    // Save environment
    const environment = await environmentService.createEnvironment(processedData);
    
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
    const environmentData = req.body;
    
    // Convert to YAML for Python processing
    const yamlData = await environmentService.convertToYAML(environmentData);
    
    // Call Python service to process the configuration
    const processedData = await pythonService.processEnvironmentConfig(yamlData);
    
    // Update environment
    const environment = await environmentService.updateEnvironment(id, processedData);
    
    res.json(environment);
  } catch (error) {
    logger.error('Error updating environment:', error);
    next(error);
  }
};

exports.deleteEnvironment = async (req, res, next) => {
  try {
    const { id } = req.params;
    await environmentService.deleteEnvironment(id);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting environment:', error);
    next(error);
  }
};

exports.deployEnvironment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deploymentOptions = req.body;
    
    const environment = await environmentService.getEnvironmentById(id);
    if (!environment) {
      return res.status(404).json({ error: 'Environment not found' });
    }
    
    // Initiate deployment through Python service
    const deployment = await pythonService.deployEnvironment(environment, deploymentOptions);
    
    res.json(deployment);
  } catch (error) {
    logger.error('Error deploying environment:', error);
    next(error);
  }
};

exports.getEnvironmentStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = await environmentService.getEnvironmentStatus(id);
    res.json(status);
  } catch (error) {
    logger.error('Error fetching environment status:', error);
    next(error);
  }
};

exports.exportEnvironment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { format = 'terraform' } = req.query;
    
    const environment = await environmentService.getEnvironmentById(id);
    if (!environment) {
      return res.status(404).json({ error: 'Environment not found' });
    }
    
    // Generate IaC through Python service
    const iacCode = await pythonService.generateIaC(environment, format);
    
    res.json({ 
      format, 
      code: iacCode,
      filename: `${environment.name}-${format}.zip`
    });
  } catch (error) {
    logger.error('Error exporting environment:', error);
    next(error);
  }
};
