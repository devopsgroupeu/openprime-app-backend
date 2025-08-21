// src/controllers/settingsController.js
const settingsService = require('../services/settingsService');
const { logger } = require('../utils/logger');

exports.getSettings = async (req, res, next) => {
  try {
    const settings = await settingsService.getAllSettings();
    res.json(settings);
  } catch (error) {
    logger.error('Error fetching settings:', error);
    next(error);
  }
};

exports.updateSettings = async (req, res, next) => {
  try {
    const settings = req.body;
    const updated = await settingsService.updateSettings(settings);
    res.json(updated);
  } catch (error) {
    logger.error('Error updating settings:', error);
    next(error);
  }
};

exports.getCloudProviders = async (req, res, next) => {
  try {
    const providers = await settingsService.getCloudProviders();
    res.json(providers);
  } catch (error) {
    logger.error('Error fetching cloud providers:', error);
    next(error);
  }
};

exports.addCloudProvider = async (req, res, next) => {
  try {
    const providerData = req.body;
    
    // Validate credentials
    const validation = await settingsService.validateCloudCredentials(providerData);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: 'Invalid cloud provider credentials',
        details: validation.errors 
      });
    }
    
    const provider = await settingsService.addCloudProvider(providerData);
    res.status(201).json(provider);
  } catch (error) {
    logger.error('Error adding cloud provider:', error);
    next(error);
  }
};

exports.updateCloudProvider = async (req, res, next) => {
  try {
    const { id } = req.params;
    const providerData = req.body;
    
    const updated = await settingsService.updateCloudProvider(id, providerData);
    res.json(updated);
  } catch (error) {
    logger.error('Error updating cloud provider:', error);
    next(error);
  }
};

exports.deleteCloudProvider = async (req, res, next) => {
  try {
    const { id } = req.params;
    await settingsService.deleteCloudProvider(id);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting cloud provider:', error);
    next(error);
  }
};

exports.getGitSettings = async (req, res, next) => {
  try {
    const gitSettings = await settingsService.getGitSettings();
    res.json(gitSettings);
  } catch (error) {
    logger.error('Error fetching git settings:', error);
    next(error);
  }
};

exports.updateGitSettings = async (req, res, next) => {
  try {
    const gitSettings = req.body;
    
    // Test git connection
    const connectionTest = await settingsService.testGitConnection(gitSettings);
    if (!connectionTest.success) {
      return res.status(400).json({ 
        error: 'Failed to connect to git repository',
        details: connectionTest.error 
      });
    }
    
    const updated = await settingsService.updateGitSettings(gitSettings);
    res.json(updated);
  } catch (error) {
    logger.error('Error updating git settings:', error);
    next(error);
  }
};

exports.getApiKeys = async (req, res, next) => {
  try {
    const apiKeys = await settingsService.getApiKeys();
    res.json(apiKeys);
  } catch (error) {
    logger.error('Error fetching API keys:', error);
    next(error);
  }
};

exports.generateApiKey = async (req, res, next) => {
  try {
    const { name, expiresIn } = req.body;
    const apiKey = await settingsService.generateApiKey({ name, expiresIn });
    res.status(201).json(apiKey);
  } catch (error) {
    logger.error('Error generating API key:', error);
    next(error);
  }
};

exports.revokeApiKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    await settingsService.revokeApiKey(id);
    res.status(204).send();
  } catch (error) {
    logger.error('Error revoking API key:', error);
    next(error);
  }
};
