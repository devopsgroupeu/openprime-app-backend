const { CloudCredential, Environment } = require("../models");
const { logger } = require("../utils/logger");
const { Op } = require("sequelize");
const { validateAwsCredentials } = require("./credentialValidationService");

// Accept both naming conventions the API has used over time: the edit form
// sends accessKey/secretKey, but stored credentials may use the
// accessKeyId/secretAccessKey names (see environmentController).
function extractCredentialPair(credentials) {
  return {
    accessKey: credentials?.accessKey ?? credentials?.accessKeyId,
    secretKey: credentials?.secretKey ?? credentials?.secretAccessKey,
  };
}

function isProvided(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidCredentialsError(message) {
  const error = new Error(message);
  error.status = 400;
  error.code = "INVALID_CREDENTIALS";
  return error;
}

function verificationFailedError(message) {
  const error = new Error(`Could not verify AWS credentials: ${message || "unknown error"}`);
  error.status = 400;
  error.code = "CREDENTIAL_VERIFICATION_FAILED";
  return error;
}

class CloudCredentialService {
  async createCredential(userId, credentialData) {
    try {
      const { provider, name, identifier, credentials, isDefault } = credentialData;

      // Validate AWS credentials against STS before persisting. A definitively
      // bad key is a user error we can surface immediately (400); a transient
      // STS outage must not block credential creation, so we log and proceed.
      let lastValidated = null;
      if (credentials) {
        const { accessKey, secretKey } = extractCredentialPair(credentials);
        const accessKeyProvided = isProvided(accessKey);
        const secretKeyProvided = isProvided(secretKey);

        if (accessKeyProvided !== secretKeyProvided) {
          throw invalidCredentialsError("Both access key and secret key are required");
        }

        if (accessKeyProvided && secretKeyProvided && provider === "aws") {
          const validation = await validateAwsCredentials(accessKey, secretKey);
          if (!validation.valid && validation.reason === "invalid_credentials") {
            throw invalidCredentialsError(validation.message || "Invalid AWS credentials");
          }
          if (!validation.valid && validation.reason === "unknown") {
            throw verificationFailedError(validation.message);
          }
          if (!validation.valid) {
            logger.warn("AWS credential validation failed; proceeding with creation", {
              reason: validation.reason,
              message: validation.message,
              userId,
              provider,
            });
          } else {
            lastValidated = new Date();
          }
        }
      }

      if (isDefault) {
        await CloudCredential.update(
          { is_default: false },
          { where: { user_id: userId, provider } },
        );
      }

      const credential = await CloudCredential.create({
        user_id: userId,
        provider,
        name,
        identifier,
        credentials,
        is_default: isDefault || false,
        ...(lastValidated && { last_validated: lastValidated }),
      });

      logger.info("Credential created", { credentialId: credential.id, userId, provider });
      return credential;
    } catch (error) {
      const errorDetails = {
        error: error.message,
        errorType: error.name,
        userId,
        provider: credentialData.provider,
      };

      // Add specific details for unique constraint violations
      if (error.name === "SequelizeUniqueConstraintError") {
        errorDetails.constraint = error.parent?.constraint;
        errorDetails.detail = error.parent?.detail;
        logger.warn("Duplicate credential attempted", errorDetails);
      } else {
        logger.error("Failed to create credential", errorDetails);
      }

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
          ["is_default", "DESC"],
          ["created_at", "DESC"],
        ],
        attributes: { exclude: ["credentials"] },
      });

      return credentials;
    } catch (error) {
      logger.error("Failed to get credentials", { error: error.message, userId, provider });
      throw error;
    }
  }

  async getCredentialById(credentialId, userId) {
    try {
      const credential = await CloudCredential.findOne({
        where: { id: credentialId, user_id: userId },
      });

      return credential;
    } catch (error) {
      logger.error("Failed to get credential", { error: error.message, credentialId, userId });
      throw error;
    }
  }

  async updateCredential(credentialId, userId, updateData) {
    try {
      const credential = await CloudCredential.findOne({
        where: { id: credentialId, user_id: userId },
      });

      if (!credential) {
        throw new Error("Credential not found");
      }

      if (updateData.isDefault) {
        await CloudCredential.update(
          { is_default: false },
          {
            where: {
              user_id: userId,
              provider: credential.provider,
              id: { [Op.ne]: credentialId },
            },
          },
        );
      }

      const updateFields = {};
      if (updateData.name !== undefined) updateFields.name = updateData.name;
      if (updateData.identifier !== undefined) updateFields.identifier = updateData.identifier;
      // Only overwrite stored secrets when the update actually provides them; an
      // empty/absent credentials object preserves the existing secret (the edit
      // form sends blanks to mean "keep current" since secrets are never
      // returned to the client).
      const { accessKey, secretKey } = extractCredentialPair(updateData.credentials);
      const accessKeyProvided = isProvided(accessKey);
      const secretKeyProvided = isProvided(secretKey);

      if (accessKeyProvided !== secretKeyProvided) {
        throw invalidCredentialsError(
          "Both access key and secret key are required to update credentials (leave both blank to keep the current ones)",
        );
      }

      if (accessKeyProvided && secretKeyProvided) {
        updateFields.credentials = updateData.credentials;

        // Validate the new AWS credentials before persisting. Blank credentials
        // mean "keep current", so validation is skipped and last_validated is
        // preserved.
        if (credential.provider === "aws") {
          const validation = await validateAwsCredentials(accessKey, secretKey);
          if (!validation.valid && validation.reason === "invalid_credentials") {
            throw invalidCredentialsError(validation.message || "Invalid AWS credentials");
          }
          if (!validation.valid && validation.reason === "unknown") {
            throw verificationFailedError(validation.message);
          }
          if (!validation.valid) {
            logger.warn("AWS credential validation failed; proceeding with update", {
              reason: validation.reason,
              message: validation.message,
              credentialId,
              userId,
            });
          } else {
            updateFields.last_validated = new Date();
          }
        }
      }
      if (updateData.isDefault !== undefined) updateFields.is_default = updateData.isDefault;

      await credential.update(updateFields);
      logger.info("Credential updated", { credentialId, userId });

      return credential;
    } catch (error) {
      logger.error("Failed to update credential", { error: error.message, credentialId, userId });
      throw error;
    }
  }

  async deleteCredential(credentialId, userId) {
    try {
      const credential = await CloudCredential.findOne({
        where: { id: credentialId, user_id: userId },
      });

      if (!credential) {
        throw new Error("Credential not found");
      }

      // Hard delete - actually remove from database
      await credential.destroy();
      logger.info("Credential deleted", { credentialId, userId });

      return { id: credentialId, deleted: true };
    } catch (error) {
      logger.error("Failed to delete credential", { error: error.message, credentialId, userId });
      throw error;
    }
  }

  async getCredentialUsage(credentialId, userId) {
    try {
      const where = { cloud_credential_id: credentialId, user_id: userId };
      const count = await Environment.count({ where });
      const environments = await Environment.findAll({
        where,
        attributes: ["id", "name"],
        limit: 50,
      });

      return {
        count,
        environments: environments.map((env) => ({ id: env.id, name: env.name })),
      };
    } catch (error) {
      logger.error("Failed to get credential usage", {
        error: error.message,
        credentialId,
        userId,
      });
      throw error;
    }
  }

  async updateLastValidated(credentialId, userId, lastValidated = new Date()) {
    try {
      await CloudCredential.update(
        { last_validated: lastValidated },
        { where: { id: credentialId, user_id: userId } },
      );
    } catch (error) {
      logger.error("Failed to update credential last_validated", {
        error: error.message,
        credentialId,
        userId,
      });
      throw error;
    }
  }

  async setDefaultCredential(credentialId, userId) {
    try {
      const credential = await CloudCredential.findOne({
        where: { id: credentialId, user_id: userId },
      });

      if (!credential) {
        throw new Error("Credential not found");
      }

      await CloudCredential.update(
        { is_default: false },
        { where: { user_id: userId, provider: credential.provider } },
      );

      await credential.update({ is_default: true });
      logger.info("Default credential set", {
        credentialId,
        userId,
        provider: credential.provider,
      });

      return credential;
    } catch (error) {
      logger.error("Failed to set default credential", {
        error: error.message,
        credentialId,
        userId,
      });
      throw error;
    }
  }
}

module.exports = new CloudCredentialService();
