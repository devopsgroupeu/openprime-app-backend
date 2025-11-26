const { CloudCredential } = require('../models');
const { logger } = require('../utils/logger');
const { Op } = require('sequelize');

class CloudCredentialService {
  async createCredential(userId, credentialData) {
    try {
      const { provider, name, identifier, credentials, isDefault } = credentialData;

      if (isDefault) {
        await CloudCredential.update(
          { is_default: false },
          { where: { user_id: userId, provider } }
        );
      }

      const credential = await CloudCredential.create({
        user_id: userId,
        provider,
        name,
        identifier,
        credentials,
        is_default: isDefault || false
      });

      logger.info('Credential created', { credentialId: credential.id, userId, provider });
      return credential;
    } catch (error) {
      logger.error('Failed to create credential', { error: error.message, userId, provider: credentialData.provider });
      throw error;
    }
  }

  async getCredentialsByUser(userId, provider = null) {
    try {
      const where = { user_id: userId, is_active: true };
      if (provider) {
        where.provider = provider;
      }

      const credentials = await CloudCredential.findAll({
        where,
        order: [
          ['is_default', 'DESC'],
          ['created_at', 'DESC']
        ],
        attributes: { exclude: ['credentials'] }
      });

      return credentials;
    } catch (error) {
      logger.error('Failed to get credentials', { error: error.message, userId, provider });
      throw error;
    }
  }

  async getCredentialById(credentialId, userId) {
    try {
      const credential = await CloudCredential.findOne({
        where: { id: credentialId, user_id: userId }
      });

      return credential;
    } catch (error) {
      logger.error('Failed to get credential', { error: error.message, credentialId, userId });
      throw error;
    }
  }

  async updateCredential(credentialId, userId, updateData) {
    try {
      const credential = await CloudCredential.findOne({
        where: { id: credentialId, user_id: userId }
      });

      if (!credential) {
        throw new Error('Credential not found');
      }

      if (updateData.isDefault) {
        await CloudCredential.update(
          { is_default: false },
          { where: { user_id: userId, provider: credential.provider, id: { [Op.ne]: credentialId } } }
        );
      }

      const updateFields = {};
      if (updateData.name !== undefined) updateFields.name = updateData.name;
      if (updateData.identifier !== undefined) updateFields.identifier = updateData.identifier;
      if (updateData.credentials !== undefined) updateFields.credentials = updateData.credentials;
      if (updateData.isDefault !== undefined) updateFields.is_default = updateData.isDefault;

      await credential.update(updateFields);
      logger.info('Credential updated', { credentialId, userId });

      return credential;
    } catch (error) {
      logger.error('Failed to update credential', { error: error.message, credentialId, userId });
      throw error;
    }
  }

  async deleteCredential(credentialId, userId) {
    try {
      const credential = await CloudCredential.findOne({
        where: { id: credentialId, user_id: userId }
      });

      if (!credential) {
        throw new Error('Credential not found');
      }

      await credential.update({ is_active: false });
      logger.info('Credential deleted', { credentialId, userId });

      return credential;
    } catch (error) {
      logger.error('Failed to delete credential', { error: error.message, credentialId, userId });
      throw error;
    }
  }

  async setDefaultCredential(credentialId, userId) {
    try {
      const credential = await CloudCredential.findOne({
        where: { id: credentialId, user_id: userId }
      });

      if (!credential) {
        throw new Error('Credential not found');
      }

      await CloudCredential.update(
        { is_default: false },
        { where: { user_id: userId, provider: credential.provider } }
      );

      await credential.update({ is_default: true });
      logger.info('Default credential set', { credentialId, userId, provider: credential.provider });

      return credential;
    } catch (error) {
      logger.error('Failed to set default credential', { error: error.message, credentialId, userId });
      throw error;
    }
  }
}

module.exports = new CloudCredentialService();
