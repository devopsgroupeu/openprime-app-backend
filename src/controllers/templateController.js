// src/controllers/templateController.js
const templateService = require('../services/templateService');
const { logger } = require('../utils/logger');

exports.getAllTemplates = async (req, res, next) => {
  try {
    const { category, tags } = req.query;
    const filters = {
      ...(category && { category }),
      ...(tags && { tags: tags.split(',') })
    };
    
    const templates = await templateService.getAllTemplates(filters);
    res.json(templates);
  } catch (error) {
    logger.error('Error fetching templates:', error);
    next(error);
  }
};

exports.getTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const template = await templateService.getTemplateById(id);
    
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    
    res.json(template);
  } catch (error) {
    logger.error('Error fetching template:', error);
    next(error);
  }
};

exports.createTemplate = async (req, res, next) => {
  try {
    const templateData = req.body;
    
    // Validate template structure
    const validation = await templateService.validateTemplate(templateData);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: 'Invalid template',
        details: validation.errors 
      });
    }
    
    const template = await templateService.createTemplate(templateData);
    res.status(201).json(template);
  } catch (error) {
    logger.error('Error creating template:', error);
    next(error);
  }
};

exports.updateTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const templateData = req.body;
    
    const template = await templateService.updateTemplate(id, templateData);
    res.json(template);
  } catch (error) {
    logger.error('Error updating template:', error);
    next(error);
  }
};

exports.deleteTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    await templateService.deleteTemplate(id);
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting template:', error);
    next(error);
  }
};

exports.cloneTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    
    const clonedTemplate = await templateService.cloneTemplate(id, { name, description });
    res.status(201).json(clonedTemplate);
  } catch (error) {
    logger.error('Error cloning template:', error);
    next(error);
  }
};
