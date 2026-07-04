const axios = require("axios");
const { logger } = require("../utils/logger");

class StateCraftService {
  constructor() {
    if (!process.env.STATECRAFT_SERVICE_URL) {
      throw new Error("Missing required environment variable: STATECRAFT_SERVICE_URL");
    }
    this.statecraftUrl = process.env.STATECRAFT_SERVICE_URL;
    // Shared service token sent to StateCraft (auth enforced once both sides configure it).
    this.serviceToken = process.env.SERVICE_TOKEN;
  }

  async createBackendResources(config) {
    try {
      const {
        region,
        bucketName,
        lockingMechanism,
        tableName,
        awsAccessKeyId,
        awsSecretAccessKey,
      } = config;

      const requestData = {
        region,
        bucket_name: bucketName,
        locking_mechanism: lockingMechanism,
      };

      // Ownership tags on the created bucket (used later by the delete guard).
      if (config.environment) requestData.environment = config.environment;
      if (config.owner) requestData.owner = config.owner;

      if (lockingMechanism === "dynamodb" && tableName) {
        requestData.table_name = tableName;
      }

      if (awsAccessKeyId && awsSecretAccessKey) {
        requestData.aws_access_key_id = awsAccessKeyId;
        requestData.aws_secret_access_key = awsSecretAccessKey;
      }

      logger.info("Creating Terraform backend resources", { bucketName, lockingMechanism, region });

      const response = await axios.post(`${this.statecraftUrl}/resources/create`, requestData, {
        headers: {
          "Content-Type": "application/json",
          ...(this.serviceToken && { "X-Service-Token": this.serviceToken }),
        },
        timeout: 60000,
      });

      logger.info("Terraform backend resources created", { bucketName, response: response.data });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error("Failed to create Terraform backend resources", {
        error: error.message,
        bucketName: config.bucketName,
        responseData: error.response?.data,
      });
      return {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
    }
  }

  async deleteBackendResources(config) {
    try {
      const {
        region,
        bucketName,
        lockingMechanism,
        tableName,
        awsAccessKeyId,
        awsSecretAccessKey,
      } = config;

      const requestData = {
        region,
        bucket_name: bucketName,
        locking_mechanism: lockingMechanism,
        // Required by StateCraft's delete guard: confirm must equal bucket_name.
        confirm: bucketName,
      };

      if (lockingMechanism === "dynamodb" && tableName) {
        requestData.table_name = tableName;
      }

      if (awsAccessKeyId && awsSecretAccessKey) {
        requestData.aws_access_key_id = awsAccessKeyId;
        requestData.aws_secret_access_key = awsSecretAccessKey;
      }

      logger.info("Deleting Terraform backend resources", { bucketName, lockingMechanism, region });

      const response = await axios.post(`${this.statecraftUrl}/resources/delete`, requestData, {
        headers: {
          "Content-Type": "application/json",
          ...(this.serviceToken && { "X-Service-Token": this.serviceToken }),
        },
        timeout: 60000,
      });

      logger.info("Terraform backend resources deleted", { bucketName, response: response.data });
      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      logger.error("Failed to delete Terraform backend resources", {
        error: error.message,
        bucketName: config.bucketName,
        responseData: error.response?.data,
      });
      return {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
    }
  }

  async healthCheck() {
    try {
      const response = await axios.get(`${this.statecraftUrl}/health`, { timeout: 5000 });
      return response.data;
    } catch (error) {
      logger.error("StateCraft health check failed", {
        error: error.message,
        url: this.statecraftUrl,
      });
      throw error;
    }
  }
}

module.exports = new StateCraftService();
