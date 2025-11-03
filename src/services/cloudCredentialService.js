const { CloudCredential, User } = require('../models');
const { logger } = require('../utils/logger');

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

      logger.info(`Created credential for user ${userId}, provider ${provider}`);
      return credential;
    } catch (error) {
      logger.error('Error creating credential:', error);
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
      logger.error('Error getting credentials:', error);
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
      logger.error('Error getting credential by ID:', error);
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
          { where: { user_id: userId, provider: credential.provider, id: { [require('sequelize').Op.ne]: credentialId } } }
        );
      }

      const updateFields = {};
      if (updateData.name !== undefined) updateFields.name = updateData.name;
      if (updateData.identifier !== undefined) updateFields.identifier = updateData.identifier;
      if (updateData.credentials !== undefined) updateFields.credentials = updateData.credentials;
      if (updateData.isDefault !== undefined) updateFields.is_default = updateData.isDefault;

      await credential.update(updateFields);
      logger.info(`Updated credential ${credentialId} for user ${userId}`);

      return credential;
    } catch (error) {
      logger.error('Error updating credential:', error);
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
      logger.info(`Deleted credential ${credentialId} for user ${userId}`);

      return credential;
    } catch (error) {
      logger.error('Error deleting credential:', error);
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
      logger.info(`Set credential ${credentialId} as default for user ${userId}`);

      return credential;
    } catch (error) {
      logger.error('Error setting default credential:', error);
      throw error;
    }
  }
}

module.exports = new CloudCredentialService();
