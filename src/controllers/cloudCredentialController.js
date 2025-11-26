const cloudCredentialService = require('../services/cloudCredentialService');
const userService = require('../services/userService');

class CloudCredentialController {
  async createCredential(req, res) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const credential = await cloudCredentialService.createCredential(user.id, req.body);

      req.log.info('Credential created', { credentialId: credential.id, provider: credential.provider });
      res.status(201).json({
        message: 'Credential created successfully',
        credential: {
          id: credential.id,
          provider: credential.provider,
          name: credential.name,
          identifier: credential.identifier,
          isDefault: credential.is_default,
          createdAt: credential.createdAt
        }
      });
    } catch (error) {
      req.log.error('Failed to create credential', { error: error.message });
      res.status(500).json({ error: 'Failed to create credential' });
    }
  }

  async getCredentials(req, res) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { provider } = req.query;
      const credentials = await cloudCredentialService.getCredentialsByUser(user.id, provider);

      res.json({
        credentials: credentials.map(cred => ({
          id: cred.id,
          provider: cred.provider,
          name: cred.name,
          identifier: cred.identifier,
          isDefault: cred.is_default,
          lastValidated: cred.last_validated,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt
        }))
      });
    } catch (error) {
      req.log.error('Failed to get credentials', { error: error.message });
      res.status(500).json({ error: 'Failed to get credentials' });
    }
  }

  async getCredentialById(req, res) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { credentialId } = req.params;
      const credential = await cloudCredentialService.getCredentialById(credentialId, user.id);

      if (!credential) {
        return res.status(404).json({ error: 'Credential not found' });
      }

      res.json({
        credential: {
          id: credential.id,
          provider: credential.provider,
          name: credential.name,
          identifier: credential.identifier,
          credentials: credential.credentials,
          isDefault: credential.is_default,
          lastValidated: credential.last_validated,
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt
        }
      });
    } catch (error) {
      req.log.error('Failed to get credential', { credentialId: req.params.credentialId, error: error.message });
      res.status(500).json({ error: 'Failed to get credential' });
    }
  }

  async updateCredential(req, res) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { credentialId } = req.params;
      const credential = await cloudCredentialService.updateCredential(credentialId, user.id, req.body);

      req.log.info('Credential updated', { credentialId });
      res.json({
        message: 'Credential updated successfully',
        credential: {
          id: credential.id,
          provider: credential.provider,
          name: credential.name,
          identifier: credential.identifier,
          isDefault: credential.is_default,
          updatedAt: credential.updatedAt
        }
      });
    } catch (error) {
      req.log.error('Failed to update credential', { credentialId: req.params.credentialId, error: error.message });
      res.status(500).json({ error: error.message || 'Failed to update credential' });
    }
  }

  async deleteCredential(req, res) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { credentialId } = req.params;
      await cloudCredentialService.deleteCredential(credentialId, user.id);

      req.log.info('Credential deleted', { credentialId });
      res.json({
        message: 'Credential deleted successfully'
      });
    } catch (error) {
      req.log.error('Failed to delete credential', { credentialId: req.params.credentialId, error: error.message });
      res.status(500).json({ error: error.message || 'Failed to delete credential' });
    }
  }

  async setDefaultCredential(req, res) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const { credentialId } = req.params;
      const credential = await cloudCredentialService.setDefaultCredential(credentialId, user.id);

      req.log.info('Default credential set', { credentialId, provider: credential.provider });
      res.json({
        message: 'Default credential set successfully',
        credential: {
          id: credential.id,
          provider: credential.provider,
          name: credential.name,
          isDefault: credential.is_default
        }
      });
    } catch (error) {
      req.log.error('Failed to set default credential', { credentialId: req.params.credentialId, error: error.message });
      res.status(500).json({ error: error.message || 'Failed to set default credential' });
    }
  }
}

module.exports = new CloudCredentialController();
