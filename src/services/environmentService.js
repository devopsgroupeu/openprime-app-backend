// src/services/environmentService.js
const yaml = require('js-yaml');
const { logger } = require('../utils/logger');
const { Environment } = require('../models');

class EnvironmentService {
  async createEnvironment(data) {
    try {
      const environmentData = {
        name: data.name,
        provider: data.provider || data.type || 'aws', // Frontend uses 'type', backend expects 'provider'
        region: data.region || null,
        location: data.location || data.region || null,
        status: 'pending',
        services: data.services || {},
        user_id: data.user_id || null
      };

      const environment = await Environment.create(environmentData);
      logger.info(`Environment created: ${environment.id} for user: ${data.user_id}`);
      
      return environment.toJSON();
    } catch (error) {
      logger.error('Error creating environment:', error);
      throw error;
    }
  }

  async getUserEnvironments(userId) {
    try {
      const environments = await Environment.findAll({
        where: { user_id: userId },
        order: [['created_at', 'DESC']]
      });

      return environments.map(env => env.toJSON());
    } catch (error) {
      logger.error('Error getting user environments:', error);
      throw error;
    }
  }

  async getEnvironmentByIdAndUser(environmentId, userId) {
    try {
      const environment = await Environment.findOne({
        where: { 
          id: environmentId,
          user_id: userId
        }
      });

      return environment ? environment.toJSON() : null;
    } catch (error) {
      logger.error('Error getting environment by ID and user:', error);
      throw error;
    }
  }

  async updateEnvironmentByUser(environmentId, userId, data) {
    try {
      const environment = await Environment.findOne({
        where: { 
          id: environmentId,
          user_id: userId
        }
      });

      if (!environment) {
        return null;
      }

      const updateData = {
        name: data.name,
        provider: data.provider || data.type,
        region: data.region,
        location: data.location || data.region,
        services: data.services
      };

      await environment.update(updateData);
      logger.info(`Environment updated: ${environment.id} for user: ${userId}`);

      return environment.toJSON();
    } catch (error) {
      logger.error('Error updating environment by user:', error);
      throw error;
    }
  }

  async deleteEnvironmentByUser(environmentId, userId) {
    try {
      const environment = await Environment.findOne({
        where: { 
          id: environmentId,
          user_id: userId
        }
      });

      if (!environment) {
        return false;
      }

      await environment.destroy();
      logger.info(`Environment deleted: ${environmentId} for user: ${userId}`);
      
      return true;
    } catch (error) {
      logger.error('Error deleting environment by user:', error);
      throw error;
    }
  }

  async convertToYAML(data) {
    return yaml.dump(data, { 
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });
  }
}

module.exports = new EnvironmentService();
