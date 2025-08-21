const terraformService = require('../services/terraformService');
const pythonService = require('../services/pythonService');
const { logger } = require('../utils/logger');

exports.generateTerraform = async (req, res, next) => {
  try {
    const configuration = req.body;
    
    // Convert configuration to YAML
    const yamlConfig = await terraformService.convertToYAML(configuration);
    
    // Generate Terraform code through Python service
    const terraformCode = await pythonService.generateTerraform(yamlConfig);
    
    res.json({ 
      code: terraformCode,
      modules: configuration.modules || []
    });
  } catch (error) {
    logger.error('Error generating Terraform:', error);
    next(error);
  }
};

exports.validateTerraform = async (req, res, next) => {
  try {
    const { configuration } = req.body;
    
    // Validate through Python service
    const validation = await pythonService.validateTerraform(configuration);
    
    res.json(validation);
  } catch (error) {
    logger.error('Error validating Terraform:', error);
    next(error);
  }
};

exports.getModules = async (req, res, next) => {
  try {
    const modules = await terraformService.getAvailableModules();
    res.json(modules);
  } catch (error) {
    logger.error('Error fetching Terraform modules:', error);
    next(error);
  }
};

exports.getModuleDetails = async (req, res, next) => {
  try {
    const { moduleName } = req.params;
    const details = await terraformService.getModuleDetails(moduleName);
    
    if (!details) {
      return res.status(404).json({ error: 'Module not found' });
    }
    
    res.json(details);
  } catch (error) {
    logger.error('Error fetching module details:', error);
    next(error);
  }
};

exports.planTerraform = async (req, res, next) => {
  try {
    const configuration = req.body;
    
    // Run Terraform plan through Python service
    const plan = await pythonService.planTerraform(configuration);
    
    res.json(plan);
  } catch (error) {
    logger.error('Error planning Terraform:', error);
    next(error);
  }
};

exports.exportTerraform = async (req, res, next) => {
  try {
    const configuration = req.body;
    
    // Generate complete Terraform package through Python service
    const exportData = await pythonService.exportTerraform(configuration);
    
    res.json(exportData);
  } catch (error) {
    logger.error('Error exporting Terraform:', error);
    next(error);
  }
};
