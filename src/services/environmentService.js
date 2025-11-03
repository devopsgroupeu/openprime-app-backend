// src/services/environmentService.js
const yaml = require('js-yaml');
const axios = require('axios');
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
        user_id: data.user_id || null,
        cloud_credential_id: data.cloudCredentialId || null
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
      const { CloudCredential } = require('../models');
      const environments = await Environment.findAll({
        where: { user_id: userId },
        include: [{
          model: CloudCredential,
          as: 'cloudCredential',
          attributes: ['id', 'name', 'identifier', 'provider']
        }],
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
      const { CloudCredential } = require('../models');
      const environment = await Environment.findOne({
        where: {
          id: environmentId,
          user_id: userId
        },
        include: [{
          model: CloudCredential,
          as: 'cloudCredential',
          attributes: ['id', 'name', 'identifier', 'provider']
        }]
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
        services: data.services,
        cloud_credential_id: data.cloudCredentialId !== undefined ? data.cloudCredentialId : environment.cloud_credential_id
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

  async generateInfrastructure(environment) {
    try {
      const injectoUrl = process.env.INJECTO_SERVICE_URL || 'http://localhost:8000';

      // Prepare configuration data for Injecto
      const configData = this.prepareInjectoData(environment);

      logger.info(`Calling Injecto service at ${injectoUrl}/process-git-download`);
      logger.debug('Configuration data:', JSON.stringify(configData, null, 2));

      // Call Injecto API
      const response = await axios.post(
        `${injectoUrl}/process-git-download`,
        {
          source: 'git',
          repo_url: process.env.INFRA_TEMPLATES_REPO_URL || 'https://github.com/DevOpsGroupEU/openprime-infra-templates.git',
          branch: process.env.INFRA_TEMPLATES_BRANCH || 'main',
          input_dir: 'templates/',
          data: configData
        },
        {
          responseType: 'arraybuffer',
          timeout: 60000, // 60 second timeout
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info(`Infrastructure generated successfully for environment: ${environment.id}`);
      return Buffer.from(response.data);
    } catch (error) {
      logger.error('Error calling Injecto service:', error.message);
      if (error.response) {
        logger.error('Injecto response status:', error.response.status);
        logger.error('Injecto response data:', error.response.data?.toString() || 'No data');
      }
      throw new Error(`Failed to generate infrastructure: ${error.message}`);
    }
  }

  prepareInjectoData(environment) {
    // Transform environment configuration to Injecto-compatible format
    const data = {
      environment: {
        name: environment.name,
        provider: environment.provider,
        region: environment.region || environment.location
      },
      services: {}
    };

    // Extract enabled services with their configurations
    if (environment.services && typeof environment.services === 'object') {
      Object.entries(environment.services).forEach(([serviceName, serviceConfig]) => {
        if (serviceConfig && serviceConfig.enabled) {
          data.services[serviceName] = {
            enabled: true,
            ...serviceConfig
          };
        }
      });
    }

    // Add Helm charts if available
    if (environment.helmCharts) {
      data.helmCharts = environment.helmCharts;
    }

    return data;
  }
}

module.exports = new EnvironmentService();
