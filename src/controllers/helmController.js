// src/controllers/helmController.js
const helmService = require('../services/helmService');
const pythonService = require('../services/pythonService');
const { logger } = require('../utils/logger');
const yaml = require('js-yaml');
const fs = require('fs').promises;

exports.getAvailableCharts = async (req, res, next) => {
  try {
    const charts = await helmService.getAvailableCharts();
    res.json(charts);
  } catch (error) {
    logger.error('Error fetching helm charts:', error);
    next(error);
  }
};

exports.getChartDetails = async (req, res, next) => {
  try {
    const { chartName } = req.params;
    const details = await helmService.getChartDetails(chartName);
    
    if (!details) {
      return res.status(404).json({ error: 'Chart not found' });
    }
    
    res.json(details);
  } catch (error) {
    logger.error('Error fetching chart details:', error);
    next(error);
  }
};

exports.getDefaultValues = async (req, res, next) => {
  try {
    const { chartName } = req.params;
    const values = await helmService.getDefaultValues(chartName);
    res.json({ chartName, values });
  } catch (error) {
    logger.error('Error fetching default values:', error);
    next(error);
  }
};

exports.validateValues = async (req, res, next) => {
  try {
    const { chartName } = req.params;
    const values = req.body;
    
    // Convert to YAML and validate through Python service
    const yamlValues = yaml.dump(values);
    const validation = await pythonService.validateHelmValues(chartName, yamlValues);
    
    res.json(validation);
  } catch (error) {
    logger.error('Error validating helm values:', error);
    next(error);
  }
};

exports.uploadValues = async (req, res, next) => {
  try {
    const { chartName } = req.params;
    const valuesFile = req.file;
    
    if (!valuesFile) {
      return res.status(400).json({ error: 'No values file provided' });
    }
    
    // Read and parse the uploaded file
    const content = await fs.readFile(valuesFile.path, 'utf8');
    const values = yaml.load(content);
    
    // Validate through Python service
    const validation = await pythonService.validateHelmValues(chartName, content);
    
    // Clean up uploaded file
    await fs.unlink(valuesFile.path);
    
    res.json({ 
      chartName,
      values,
      validation 
    });
  } catch (error) {
    logger.error('Error uploading helm values:', error);
    next(error);
  }
};

exports.generateValues = async (req, res, next) => {
  try {
    const configuration = req.body;
    
    // Generate Helm values through Python service
    const generatedValues = await pythonService.generateHelmValues(configuration);
    
    res.json({ 
      values: generatedValues,
      format: 'yaml'
    });
  } catch (error) {
    logger.error('Error generating helm values:', error);
    next(error);
  }
};
