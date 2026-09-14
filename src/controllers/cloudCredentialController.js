const cloudCredentialService = require("../services/cloudCredentialService");
const userService = require("../services/userService");
const { validateAwsCredentials } = require("../services/credentialValidationService");

function isProvided(value) {
  return typeof value === "string" && value.trim().length > 0;
}

class CloudCredentialController {
  async createCredential(req, res, next) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found", requestId: req.requestId });
      }

      const credential = await cloudCredentialService.createCredential(user.id, req.body);

      req.log.info("Credential created", {
        credentialId: credential.id,
        provider: credential.provider,
      });
      res.status(201).json({
        message: "Credential created successfully",
        credential: {
          id: credential.id,
          provider: credential.provider,
          name: credential.name,
          identifier: credential.identifier,
          isDefault: credential.is_default,
          createdAt: credential.createdAt,
        },
      });
    } catch (error) {
      // Handle Sequelize unique constraint violation (expected user error, not system error)
      if (error.name === "SequelizeUniqueConstraintError") {
        req.log.warn("Duplicate credential creation attempted", {
          error: error.message,
          provider: req.body.provider,
          name: req.body.name,
        });
        return res.status(409).json({
          error: "A credential with this name already exists for this provider",
          requestId: req.requestId,
        });
      }

      // Handle Sequelize validation errors
      if (error.name === "SequelizeValidationError") {
        const messages = error.errors?.map((e) => e.message).join(", ") || error.message;
        req.log.warn("Credential validation failed", { error: messages });
        return res.status(400).json({ error: messages, requestId: req.requestId });
      }

      // Log unexpected errors (including INVALID_CREDENTIALS, which the central
      // handler turns into a 400 with the AWS-derived message) and let the
      // central error handler respond so requestId is propagated.
      req.log.error("Failed to create credential", { error: error.message, name: error.name });
      next(error);
    }
  }

  async getCredentials(req, res, next) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found", requestId: req.requestId });
      }

      const { provider } = req.query;
      const credentials = await cloudCredentialService.getCredentialsByUser(user.id, provider);

      res.json({
        credentials: credentials.map((cred) => ({
          id: cred.id,
          provider: cred.provider,
          name: cred.name,
          identifier: cred.identifier,
          isDefault: cred.is_default,
          lastValidated: cred.last_validated,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        })),
      });
    } catch (error) {
      req.log.error("Failed to get credentials", { error: error.message });
      next(error);
    }
  }

  async getCredentialById(req, res, next) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found", requestId: req.requestId });
      }

      const { credentialId } = req.params;
      const credential = await cloudCredentialService.getCredentialById(credentialId, user.id);

      if (!credential) {
        return res.status(404).json({ error: "Credential not found", requestId: req.requestId });
      }

      // Never return decrypted secret material to the client. Decryption stays
      // server-side (StateCraft/git operations); the edit form treats blank
      // secret fields as "keep the stored credentials".
      res.json({
        credential: {
          id: credential.id,
          provider: credential.provider,
          name: credential.name,
          identifier: credential.identifier,
          isDefault: credential.is_default,
          lastValidated: credential.last_validated,
          createdAt: credential.createdAt,
          updatedAt: credential.updatedAt,
        },
      });
    } catch (error) {
      req.log.error("Failed to get credential", {
        credentialId: req.params.credentialId,
        error: error.message,
      });
      next(error);
    }
  }

  async updateCredential(req, res, next) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found", requestId: req.requestId });
      }

      const { credentialId } = req.params;
      const credential = await cloudCredentialService.updateCredential(
        credentialId,
        user.id,
        req.body,
      );

      req.log.info("Credential updated", { credentialId });
      res.json({
        message: "Credential updated successfully",
        credential: {
          id: credential.id,
          provider: credential.provider,
          name: credential.name,
          identifier: credential.identifier,
          isDefault: credential.is_default,
          updatedAt: credential.updatedAt,
        },
      });
    } catch (error) {
      req.log.error("Failed to update credential", {
        credentialId: req.params.credentialId,
        error: error.message,
      });
      next(error);
    }
  }

  async deleteCredential(req, res, next) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found", requestId: req.requestId });
      }

      const { credentialId } = req.params;
      await cloudCredentialService.deleteCredential(credentialId, user.id);

      req.log.info("Credential deleted", { credentialId });
      res.json({
        message: "Credential deleted successfully",
      });
    } catch (error) {
      req.log.error("Failed to delete credential", {
        credentialId: req.params.credentialId,
        error: error.message,
      });
      next(error);
    }
  }

  async testCredential(req, res, next) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found", requestId: req.requestId });
      }

      const { credentialId } = req.params;
      const credential = await cloudCredentialService.getCredentialById(credentialId, user.id);

      if (!credential) {
        return res.status(404).json({ error: "Credential not found", requestId: req.requestId });
      }

      const storedCredentials = credential.credentials || {};
      const accessKey = storedCredentials.accessKey ?? storedCredentials.accessKeyId;
      const secretKey = storedCredentials.secretKey ?? storedCredentials.secretAccessKey;
      if (!isProvided(accessKey) || !isProvided(secretKey)) {
        return res.status(400).json({
          error: "Credential does not contain AWS access key and secret key",
          requestId: req.requestId,
        });
      }

      const validation = await validateAwsCredentials(accessKey, secretKey);

      // 200 for both outcomes: the test ran successfully, the result just
      // happens to be "invalid". Only a service-level failure is an error.
      if (validation.valid) {
        const lastValidated = new Date();
        await cloudCredentialService.updateLastValidated(credentialId, user.id, lastValidated);
        return res.status(200).json({
          valid: true,
          accountId: validation.accountId,
          arn: validation.arn,
          // The identifier is hand-typed and feeds Terraform bucket names
          // (`${identifier}-terraform-${env}`), so surface a mismatch with the
          // STS account id instead of silently building misnamed buckets.
          accountIdMismatch: validation.accountId !== credential.identifier,
          message: "Credentials are valid",
          lastValidated,
        });
      }

      return res.status(200).json({
        valid: false,
        reason: validation.reason,
        message: validation.message,
      });
    } catch (error) {
      req.log.error("Failed to test credential", {
        credentialId: req.params.credentialId,
        error: error.message,
      });
      next(error);
    }
  }

  async getCredentialUsage(req, res, next) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found", requestId: req.requestId });
      }

      const { credentialId } = req.params;
      const usage = await cloudCredentialService.getCredentialUsage(credentialId, user.id);

      res.json(usage);
    } catch (error) {
      req.log.error("Failed to get credential usage", {
        credentialId: req.params.credentialId,
        error: error.message,
      });
      next(error);
    }
  }

  async setDefaultCredential(req, res, next) {
    try {
      const user = await userService.getUserByKeycloakId(req.user.id);
      if (!user) {
        return res.status(404).json({ error: "User not found", requestId: req.requestId });
      }

      const { credentialId } = req.params;
      const credential = await cloudCredentialService.setDefaultCredential(credentialId, user.id);

      req.log.info("Default credential set", { credentialId, provider: credential.provider });
      res.json({
        message: "Default credential set successfully",
        credential: {
          id: credential.id,
          provider: credential.provider,
          name: credential.name,
          isDefault: credential.is_default,
        },
      });
    } catch (error) {
      req.log.error("Failed to set default credential", {
        credentialId: req.params.credentialId,
        error: error.message,
      });
      next(error);
    }
  }
}

module.exports = new CloudCredentialController();
