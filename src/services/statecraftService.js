const axios = require('axios');
const { logger } = require('../utils/logger');

class StateCraftService {
  constructor() {
    this.statecraftUrl = process.env.STATECRAFT_SERVICE_URL || 'http://statecraft-local:8000';
  }

  async createBackendResources(config) {
    try {
      const { region, bucketName, lockingMechanism, tableName, awsAccessKeyId, awsSecretAccessKey } = config;

      const requestData = {
        region,
        bucket_name: bucketName,
        locking_mechanism: lockingMechanism
      };

      if (lockingMechanism === 'dynamodb' && tableName) {
        requestData.table_name = tableName;
      }

      if (awsAccessKeyId && awsSecretAccessKey) {
        requestData.aws_access_key_id = awsAccessKeyId;
        requestData.aws_secret_access_key = awsSecretAccessKey;
      }

      logger.info(`Creating Terraform backend resources: bucket=${bucketName}, locking=${lockingMechanism}`);

      const response = await axios.post(`${this.statecraftUrl}/resources/create`, requestData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });

      logger.info('Terraform backend resources created successfully', response.data);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error creating Terraform backend resources:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.detail || error.message
      };
    }
  }

  async deleteBackendResources(config) {
    try {
      const { region, bucketName, lockingMechanism, tableName, awsAccessKeyId, awsSecretAccessKey } = config;

      const requestData = {
        region,
        bucket_name: bucketName,
        locking_mechanism: lockingMechanism
      };

      if (lockingMechanism === 'dynamodb' && tableName) {
        requestData.table_name = tableName;
      }

      if (awsAccessKeyId && awsSecretAccessKey) {
        requestData.aws_access_key_id = awsAccessKeyId;
        requestData.aws_secret_access_key = awsSecretAccessKey;
      }

      logger.info(`Deleting Terraform backend resources: bucket=${bucketName}, locking=${lockingMechanism}`);

      const response = await axios.post(`${this.statecraftUrl}/resources/delete`, requestData, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 60000
      });

      logger.info('Terraform backend resources deleted successfully', response.data);
      return {
        success: true,
        data: response.data
      };
    } catch (error) {
      logger.error('Error deleting Terraform backend resources:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.detail || error.message
      };
    }
  }

  async healthCheck() {
    try {
      const response = await axios.get(`${this.statecraftUrl}/health`, { timeout: 5000 });
      return response.data;
    } catch (error) {
      logger.error('StateCraft health check failed:', error.message);
      throw error;
    }
  }
}

module.exports = new StateCraftService();
