// src/services/deploymentService.js
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const EventEmitter = require('events');

class DeploymentService {
  constructor() {
    this.deployments = new Map();
    this.logEmitters = new Map();
  }

  async getAllDeployments(filters = {}, options = {}) {
    let deployments = Array.from(this.deployments.values());
    
    // Apply filters
    if (filters.environmentId) {
      deployments = deployments.filter(d => d.environmentId === filters.environmentId);
    }
    if (filters.status) {
      deployments = deployments.filter(d => d.status === filters.status);
    }
    
    // Apply pagination
    const start = parseInt(options.offset) || 0;
    const limit = parseInt(options.limit) || 50;
    
    return {
      data: deployments.slice(start, start + limit),
      total: deployments.length,
      offset: start,
      limit
    };
  }

  async getDeploymentById(id) {
    return this.deployments.get(id);
  }

  async createDeployment(data) {
    const id = uuidv4();
    const deployment = {
      id,
      ...data,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      logs: []
    };
    
    this.deployments.set(id, deployment);
    this.logEmitters.set(id, new EventEmitter());
    
    logger.info(`Deployment created: ${id}`);
    return deployment;
  }

  async updateDeploymentStatus(id, status, details = {}) {
    const deployment = this.deployments.get(id);
    if (!deployment) {
      throw new Error('Deployment not found');
    }
    
    deployment.status = status;
    deployment.updatedAt = new Date().toISOString();
    deployment.details = { ...deployment.details, ...details };
    
    this.deployments.set(id, deployment);
    logger.info(`Deployment ${id} status updated to ${status}`);
    
    return deployment;
  }

  async validateDeployment(data) {
    const errors = [];
    
    if (!data.environmentId) {
      errors.push('Environment ID is required');
    }
    if (!data.version) {
      errors.push('Version is required');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  async getDeploymentLogs(id, options = {}) {
    const deployment = this.deployments.get(id);
    if (!deployment) {
      throw new Error('Deployment not found');
    }
    
    if (options.follow) {
      return this.logEmitters.get(id);
    }
    
    const tail = parseInt(options.tail) || 100;
    return deployment.logs.slice(-tail);
  }

  async rollbackDeployment(id, targetVersion) {
    const deployment = this.deployments.get(id);
    if (!deployment) {
      throw new Error('Deployment not found');
    }
    
    const rollbackDeployment = {
      ...deployment,
      id: uuidv4(),
      type: 'rollback',
      targetVersion,
      originalDeploymentId: id,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    this.deployments.set(rollbackDeployment.id, rollbackDeployment);
    logger.info(`Rollback initiated for deployment ${id} to version ${targetVersion}`);
    
    return rollbackDeployment;
  }

  async getDeploymentMetrics(id, _options = {}) {
    const deployment = this.deployments.get(id);
    if (!deployment) {
      throw new Error('Deployment not found');
    }
    
    // In production, this would fetch actual metrics from monitoring systems
    return {
      deploymentId: id,
      metrics: {
        cpu: Math.random() * 100,
        memory: Math.random() * 100,
        requests: Math.floor(Math.random() * 10000),
        errors: Math.floor(Math.random() * 100),
        latency: Math.random() * 500
      },
      timestamp: new Date().toISOString()
    };
  }

  addLogEntry(deploymentId, log) {
    const deployment = this.deployments.get(deploymentId);
    if (deployment) {
      deployment.logs.push({
        timestamp: new Date().toISOString(),
        level: log.level || 'info',
        message: log.message
      });
      
      const emitter = this.logEmitters.get(deploymentId);
      if (emitter) {
        emitter.emit('data', log);
      }
    }
  }
}

module.exports = new DeploymentService();
