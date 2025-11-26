// src/services/environmentService.js
const yaml = require('js-yaml');
const axios = require('axios');
const { logger } = require('../utils/logger');
const { Environment } = require('../models');

// Validate required environment variable
if (!process.env.INJECTO_SERVICE_URL) {
  throw new Error('Missing required environment variable: INJECTO_SERVICE_URL');
}

class EnvironmentService {
  async createEnvironment(data) {
    try {
      const environmentData = {
        name: data.name,
        provider: data.provider || data.type || 'aws',
        region: data.region || null,
        location: data.location || data.region || null,
        status: 'pending',
        services: data.services || {},
        terraform_backend: data.terraformBackend || null,
        git_repository: data.gitRepository || null,
        user_id: data.user_id || null,
        cloud_credential_id: data.cloudCredentialId || null
      };

      const environment = await Environment.create(environmentData);
      logger.info('Environment created', { environmentId: environment.id, userId: data.user_id });

      return environment.toJSON();
    } catch (error) {
      logger.error('Failed to create environment', { error: error.message, userId: data.user_id });
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
      logger.error('Failed to get user environments', { error: error.message, userId });
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
      logger.error('Failed to get environment', { error: error.message, environmentId, userId });
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
        terraform_backend: data.terraformBackend !== undefined ? data.terraformBackend : environment.terraform_backend,
        git_repository: data.gitRepository !== undefined ? data.gitRepository : environment.git_repository,
        cloud_credential_id: data.cloudCredentialId !== undefined ? data.cloudCredentialId : environment.cloud_credential_id
      };

      await environment.update(updateData);
      logger.info('Environment updated', { environmentId: environment.id, userId });

      return environment.toJSON();
    } catch (error) {
      logger.error('Failed to update environment', { error: error.message, environmentId, userId });
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
      logger.info('Environment deleted', { environmentId, userId });

      return true;
    } catch (error) {
      logger.error('Failed to delete environment', { error: error.message, environmentId, userId });
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
      const injectoUrl = process.env.INJECTO_SERVICE_URL;

      // Prepare configuration data for Injecto
      const configData = this.prepareInjectoData(environment);

      logger.info('Calling Injecto service', { url: `${injectoUrl}/process-git-download`, environmentId: environment.id });
      logger.debug('Injecto configuration', { data: configData });

      // Call Injecto API
      const response = await axios.post(
        `${injectoUrl}/process-git-download`,
        {
          source: 'git',
          repo_url: process.env.INFRA_TEMPLATES_REPO_URL,
          branch: process.env.INFRA_TEMPLATES_BRANCH,
          input_dir: 'templates/',
          data: configData
        },
        {
          responseType: 'arraybuffer',
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      logger.info('Infrastructure generated', { environmentId: environment.id });
      return Buffer.from(response.data);
    } catch (error) {
      logger.error('Injecto service call failed', {
        error: error.message,
        environmentId: environment.id,
        status: error.response?.status,
        responseData: error.response?.data?.toString()
      });
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
