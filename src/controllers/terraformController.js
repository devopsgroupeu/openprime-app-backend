const terraformService = require('../services/terraformService');
// Python service removed - external processing will be handled separately
const { logger } = require('../utils/logger');

exports.generateTerraform = async (req, res, next) => {
  try {
    const configuration = req.body;
    
    // Convert configuration to YAML
    const _yamlConfig = await terraformService.convertToYAML(configuration);
    
    // Terraform generation will be handled externally
    const terraformCode = `# Terraform code for configuration will be generated externally`;
    
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
    const { configuration: _configuration } = req.body;
    
    // Terraform validation will be handled externally
    const validation = { valid: true, message: 'Validation will be handled externally' };
    
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
    const _configuration = req.body;
    
    // Terraform planning will be handled externally
    const plan = { status: 'queued', message: 'Terraform plan queued for external processing' };
    
    res.json(plan);
  } catch (error) {
    logger.error('Error planning Terraform:', error);
    next(error);
  }
};

exports.exportTerraform = async (req, res, next) => {
  try {
    const _configuration = req.body;
    
    // Terraform export will be handled externally
    const exportData = { status: 'queued', message: 'Terraform export queued for external processing' };
    
    res.json(exportData);
  } catch (error) {
    logger.error('Error exporting Terraform:', error);
    next(error);
  }
};
