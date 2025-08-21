// src/controllers/deploymentController.js
const deploymentService = require('../services/deploymentService');
const pythonService = require('../services/pythonService');
const { logger } = require('../utils/logger');

exports.getAllDeployments = async (req, res, next) => {
  try {
    const { environmentId, status, limit = 50, offset = 0 } = req.query;
    const filters = {
      ...(environmentId && { environmentId }),
      ...(status && { status })
    };
    
    const deployments = await deploymentService.getAllDeployments(filters, { limit, offset });
    res.json(deployments);
  } catch (error) {
    logger.error('Error fetching deployments:', error);
    next(error);
  }
};

exports.getDeployment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deployment = await deploymentService.getDeploymentById(id);
    
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    
    res.json(deployment);
  } catch (error) {
    logger.error('Error fetching deployment:', error);
    next(error);
  }
};

exports.createDeployment = async (req, res, next) => {
  try {
    const deploymentData = req.body;
    
    // Validate deployment configuration
    const validation = await deploymentService.validateDeployment(deploymentData);
    if (!validation.valid) {
      return res.status(400).json({ 
        error: 'Invalid deployment configuration',
        details: validation.errors 
      });
    }
    
    // Create deployment record
    const deployment = await deploymentService.createDeployment(deploymentData);
    
    // Trigger deployment through Python service
    pythonService.executeDeployment(deployment)
      .then(result => {
        deploymentService.updateDeploymentStatus(deployment.id, 'completed', result);
      })
      .catch(error => {
        deploymentService.updateDeploymentStatus(deployment.id, 'failed', { error: error.message });
      });
    
    res.status(202).json(deployment);
  } catch (error) {
    logger.error('Error creating deployment:', error);
    next(error);
  }
};

exports.getDeploymentLogs = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tail = 100, follow = false } = req.query;
    
    const logs = await deploymentService.getDeploymentLogs(id, { tail, follow });
    
    if (follow) {
      // Set up SSE for log streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      
      logs.on('data', (log) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
      });
      
      req.on('close', () => {
        logs.destroy();
      });
    } else {
      res.json(logs);
    }
  } catch (error) {
    logger.error('Error fetching deployment logs:', error);
    next(error);
  }
};

exports.rollbackDeployment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { targetVersion } = req.body;
    
    const deployment = await deploymentService.getDeploymentById(id);
    if (!deployment) {
      return res.status(404).json({ error: 'Deployment not found' });
    }
    
    const rollback = await deploymentService.rollbackDeployment(id, targetVersion);
    
    res.json(rollback);
  } catch (error) {
    logger.error('Error rolling back deployment:', error);
    next(error);
  }
};

exports.getDeploymentMetrics = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { startTime, endTime, metrics } = req.query;
    
    const metricsData = await deploymentService.getDeploymentMetrics(id, {
      startTime,
      endTime,
      metrics: metrics ? metrics.split(',') : undefined
    });
    
    res.json(metricsData);
  } catch (error) {
    logger.error('Error fetching deployment metrics:', error);
    next(error);
  }
};
