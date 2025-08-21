// src/services/environmentService.js
const yaml = require('js-yaml');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

class EnvironmentService {
  constructor() {
    // In production, this would use a database
    this.environments = new Map();
  }

  async getAllEnvironments() {
    return Array.from(this.environments.values());
  }

  async getEnvironmentById(id) {
    return this.environments.get(id);
  }

  async createEnvironment(data) {
    const id = uuidv4();
    const environment = {
      id,
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending'
    };
    
    this.environments.set(id, environment);
    logger.info(`Environment created: ${id}`);
    
    return environment;
  }

  async updateEnvironment(id, data) {
    const existing = this.environments.get(id);
    if (!existing) {
      throw new Error('Environment not found');
    }
    
    const updated = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString()
    };
    
    this.environments.set(id, updated);
    logger.info(`Environment updated: ${id}`);
    
    return updated;
  }

  async deleteEnvironment(id) {
    const deleted = this.environments.delete(id);
    if (!deleted) {
      throw new Error('Environment not found');
    }
    logger.info(`Environment deleted: ${id}`);
  }

  async convertToYAML(data) {
    return yaml.dump(data, { 
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });
  }

  async getEnvironmentStatus(id) {
    const environment = this.environments.get(id);
    if (!environment) {
      throw new Error('Environment not found');
    }
    
    // In production, this would check actual infrastructure status
    return {
      id,
      status: environment.status || 'running',
      health: 'healthy',
      resources: {
        vpc: environment.services?.vpc?.enabled ? 'active' : 'inactive',
        eks: environment.services?.eks?.enabled ? 'active' : 'inactive',
        rds: environment.services?.rds?.enabled ? 'active' : 'inactive'
      },
      lastChecked: new Date().toISOString()
    };
  }
}

module.exports = new EnvironmentService();
