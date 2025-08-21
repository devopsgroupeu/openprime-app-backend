// src/services/settingsService.js
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

class SettingsService {
  constructor() {
    this.settings = {
      general: {
        platformName: 'OpenPrime',
        defaultRegion: 'us-east-1',
        autoCommit: true,
        enforecMFA: true,
        encryptionAtRest: true,
        auditLogging: true
      },
      git: {
        repositoryUrl: '',
        defaultBranch: 'main',
        autoCommit: true,
        commitMessage: 'OpenPrime: Infrastructure update'
      },
      security: {
        mfaEnabled: true,
        sessionTimeout: 3600,
        passwordPolicy: {
          minLength: 12,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSymbols: true
        }
      }
    };
    
    this.cloudProviders = new Map();
    this.apiKeys = new Map();
  }

  async getAllSettings() {
    return this.settings;
  }

  async updateSettings(newSettings) {
    this.settings = {
      ...this.settings,
      ...newSettings
    };
    
    logger.info('Settings updated');
    return this.settings;
  }

  async getCloudProviders() {
    return Array.from(this.cloudProviders.values()).map(provider => ({
      ...provider,
      credentials: undefined // Don't expose credentials
    }));
  }

  async addCloudProvider(data) {
    const id = uuidv4();
    const provider = {
      id,
      ...data,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    
    this.cloudProviders.set(id, provider);
    logger.info(`Cloud provider added: ${data.type}`);
    
    // Test connection
    const connectionTest = await this.testCloudConnection(provider);
    provider.status = connectionTest.success ? 'connected' : 'failed';
    this.cloudProviders.set(id, provider);
    
    return {
      ...provider,
      credentials: undefined
    };
  }

  async updateCloudProvider(id, data) {
    const existing = this.cloudProviders.get(id);
    if (!existing) {
      throw new Error('Cloud provider not found');
    }
    
    const updated = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString()
    };
    
    this.cloudProviders.set(id, updated);
    logger.info(`Cloud provider updated: ${id}`);
    
    return {
      ...updated,
      credentials: undefined
    };
  }

  async deleteCloudProvider(id) {
    const deleted = this.cloudProviders.delete(id);
    if (!deleted) {
      throw new Error('Cloud provider not found');
    }
    logger.info(`Cloud provider deleted: ${id}`);
  }

  async validateCloudCredentials(data) {
    const errors = [];
    
    if (!data.type) {
      errors.push('Provider type is required');
    }
    
    if (data.type === 'aws') {
      if (!data.credentials?.accessKeyId) {
        errors.push('AWS Access Key ID is required');
      }
      if (!data.credentials?.secretAccessKey) {
        errors.push('AWS Secret Access Key is required');
      }
    } else if (data.type === 'azure') {
      if (!data.credentials?.tenantId) {
        errors.push('Azure Tenant ID is required');
      }
      if (!data.credentials?.clientId) {
        errors.push('Azure Client ID is required');
      }
      if (!data.credentials?.clientSecret) {
        errors.push('Azure Client Secret is required');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  async testCloudConnection(_provider) {
    // In production, this would actually test the connection
    // For now, simulate a successful connection
    return {
      success: true,
      message: 'Connection successful'
    };
  }

  async getGitSettings() {
    return this.settings.git;
  }

  async updateGitSettings(gitSettings) {
    this.settings.git = {
      ...this.settings.git,
      ...gitSettings
    };
    
    logger.info('Git settings updated');
    return this.settings.git;
  }

  async testGitConnection(gitSettings) {
    // In production, this would test the git connection
    // For now, simulate a successful connection
    if (!gitSettings.repositoryUrl) {
      return {
        success: false,
        error: 'Repository URL is required'
      };
    }
    
    return {
      success: true,
      message: 'Git connection successful'
    };
  }

  async getApiKeys() {
    return Array.from(this.apiKeys.values()).map(key => ({
      id: key.id,
      name: key.name,
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
      lastUsed: key.lastUsed,
      // Don't expose the actual key
      key: key.key.substring(0, 8) + '...'
    }));
  }

  async generateApiKey(options = {}) {
    const id = uuidv4();
    const key = this.generateSecureKey();
    
    const apiKey = {
      id,
      name: options.name || 'API Key',
      key: key,
      createdAt: new Date().toISOString(),
      expiresAt: options.expiresIn ? 
        new Date(Date.now() + this.parseExpiration(options.expiresIn)).toISOString() : 
        null,
      lastUsed: null
    };
    
    this.apiKeys.set(id, apiKey);
    logger.info(`API key generated: ${id}`);
    
    return {
      ...apiKey,
      key: key // Return full key only on creation
    };
  }

  async revokeApiKey(id) {
    const deleted = this.apiKeys.delete(id);
    if (!deleted) {
      throw new Error('API key not found');
    }
    logger.info(`API key revoked: ${id}`);
  }

  generateSecureKey() {
    return 'opk_' + crypto.randomBytes(32).toString('hex');
  }

  parseExpiration(expiresIn) {
    const units = {
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000,
      m: 30 * 24 * 60 * 60 * 1000
    };
    
    const match = expiresIn.match(/^(\d+)([hdwm])$/);
    if (!match) {
      return 30 * 24 * 60 * 60 * 1000; // Default 30 days
    }
    
    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }
}

module.exports = new SettingsService();
