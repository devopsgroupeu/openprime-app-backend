// src/services/environmentService.js
const yaml = require("js-yaml");
const axios = require("axios");
const { logger } = require("../utils/logger");
const { Environment } = require("../models");
const fs = require("fs");
const os = require("os");
const path = require("path");
const AdmZip = require("adm-zip");
const simpleGit = require("simple-git");

// Validate required environment variable
if (!process.env.INJECTO_SERVICE_URL) {
  throw new Error("Missing required environment variable: INJECTO_SERVICE_URL");
}

class EnvironmentService {
  async createEnvironment(data) {
    try {
      const environmentData = {
        name: data.name,
        global_prefix: data.globalPrefix,
        provider: data.provider || data.type || "aws",
        region: data.region || null,
        location: data.location || data.region || null,
        status: "pending",
        services: data.services || {},
        terraform_backend: data.terraformBackend || null,
        git_repository: data.gitRepository || null,
        user_id: data.user_id || null,
        cloud_credential_id: data.cloudCredentialId || null,
      };

      const environment = await Environment.create(environmentData);
      logger.info("Environment created", { environmentId: environment.id, userId: data.user_id });

      return environment.toJSON();
    } catch (error) {
      logger.error("Failed to create environment", { error: error.message, userId: data.user_id });
      throw error;
    }
  }

  async getUserEnvironments(userId) {
    try {
      const { CloudCredential } = require("../models");
      const environments = await Environment.findAll({
        where: { user_id: userId },
        include: [
          {
            model: CloudCredential,
            as: "cloudCredential",
            attributes: ["id", "name", "identifier", "provider"],
          },
        ],
        order: [["created_at", "DESC"]],
      });

      return environments.map((env) => env.toJSON());
    } catch (error) {
      logger.error("Failed to get user environments", { error: error.message, userId });
      throw error;
    }
  }

  async getEnvironmentByIdAndUser(environmentId, userId) {
    try {
      const { CloudCredential } = require("../models");
      const environment = await Environment.findOne({
        where: {
          id: environmentId,
          user_id: userId,
        },
        include: [
          {
            model: CloudCredential,
            as: "cloudCredential",
            attributes: ["id", "name", "identifier", "provider"],
          },
        ],
      });

      return environment ? environment.toJSON() : null;
    } catch (error) {
      logger.error("Failed to get environment", { error: error.message, environmentId, userId });
      throw error;
    }
  }

  async updateEnvironmentByUser(environmentId, userId, data) {
    try {
      const environment = await Environment.findOne({
        where: {
          id: environmentId,
          user_id: userId,
        },
      });

      if (!environment) {
        return null;
      }

      const updateData = {
        name: data.name,
        global_prefix:
          data.globalPrefix !== undefined ? data.globalPrefix : environment.global_prefix,
        provider: data.provider || data.type,
        region: data.region,
        location: data.location || data.region,
        services: data.services,
        terraform_backend:
          data.terraformBackend !== undefined
            ? data.terraformBackend
            : environment.terraform_backend,
        git_repository:
          data.gitRepository !== undefined ? data.gitRepository : environment.git_repository,
        cloud_credential_id:
          data.cloudCredentialId !== undefined
            ? data.cloudCredentialId
            : environment.cloud_credential_id,
      };

      await environment.update(updateData);
      logger.info("Environment updated", { environmentId: environment.id, userId });

      return environment.toJSON();
    } catch (error) {
      logger.error("Failed to update environment", { error: error.message, environmentId, userId });
      throw error;
    }
  }

  async deleteEnvironmentByUser(environmentId, userId) {
    try {
      const environment = await Environment.findOne({
        where: {
          id: environmentId,
          user_id: userId,
        },
      });

      if (!environment) {
        return false;
      }

      await environment.destroy();
      logger.info("Environment deleted", { environmentId, userId });

      return true;
    } catch (error) {
      logger.error("Failed to delete environment", { error: error.message, environmentId, userId });
      throw error;
    }
  }

  async convertToYAML(data) {
    return yaml.dump(data, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    });
  }

  async generateInfrastructure(environment) {
    try {
      const injectoUrl = process.env.INJECTO_SERVICE_URL;

      // Prepare configuration data for Injecto
      const configData = this.prepareInjectoData(environment);

      logger.info("Calling Injecto service", {
        url: `${injectoUrl}/process-git-download`,
        environmentId: environment.id,
      });
      const { gitRepository, ...configDataNoGit } = configData;
      logger.debug("Injecto configuration", { data: configDataNoGit });

      // Call Injecto API
      const response = await axios.post(
        `${injectoUrl}/process-git-download`,
        {
          source: "git",
          repo_url: process.env.INFRA_TEMPLATES_REPO_URL,
          branch: process.env.INFRA_TEMPLATES_BRANCH,
          input_dir: "templates/",
          data: configData,
        },
        {
          responseType: "arraybuffer",
          timeout: 60000,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      logger.info("Infrastructure generated", { environmentId: environment.id });
      return Buffer.from(response.data);
    } catch (error) {
      logger.error("Injecto service call failed", {
        error: error.message,
        environmentId: environment.id,
        status: error.response?.status,
        responseData: error.response?.data?.toString(),
      });
      throw new Error(`Failed to generate infrastructure: ${error.message}`, {
        cause: error,
      });
    }
  }

  async pushInfrastructure(zipBuffer, git_repository) {
    // Create temporary dir
    logger.info("Creating temp directories");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openprime-push-dir-"));
    const gitDir = path.join(tempDir, "git");
    const extractDir = path.join(tempDir, "extract");
    const keyDir = path.join(tempDir, "ssh_key");

    try {
      // Git config - key
      // git key refactor
      const sshKey = git_repository.sshKey.replace(/\\n/g, "\n").trim() + "\n";
      fs.writeFileSync(keyDir, sshKey, { mode: 0o600 });

      const git = simpleGit().env(
        "GIT_SSH_COMMAND",
        `ssh -i ${keyDir} -o StrictHostKeyChecking=no`,
      );

      // Clone user repo
      logger.info("Cloning user repository", { url: git_repository.url });
      await git.clone(git_repository.url, gitDir);

      // Extract zip
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(extractDir, true);

      // Copy extracted files to cloned repo dir
      this.recursiveCopy(extractDir, gitDir);

      // Switch to cloned repo Dir
      await git.cwd(gitDir);

      // Git identity + stage
      await git.addConfig("user.email", "generated_by@openprime.com");
      await git.addConfig("user.name", "OpenPrime");
      await git.add(".");

      // Check if there are changes
      const status = await git.status();
      if (status.isClean()) {
        logger.info("No changes to commit — repository is already up to date");
        return { status: "success", message: "Repository is already up to date" };
      }

      // Push
      await git.commit("Generated infrastructure with OpenPrime");
      await git.push();
      return { status: "success", message: "Infrastructure pushed to Git" };
    } catch (error) {
      logger.error("Failed to push to Git", { error: error.message });
      throw new Error(`Failed to push to Git: ${error.message}`);
    } finally {
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  recursiveCopy(src, dest) {
    for (const item of fs.readdirSync(src)) {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);
      if (fs.statSync(srcPath).isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        this.recursiveCopy(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  prepareInjectoData(environment) {
    // Transform environment configuration to Injecto-compatible format
    const data = {
      name: environment.name,
      globalPrefix: environment.global_prefix || environment.globalPrefix || "",
      provider: environment.provider,
      region: environment.region || environment.location,
      terraformBackend: environment.terraform_backend || null,
      gitRepository: environment.git_repository || null,
      services: {},
    };

    // Extract enabled services with their configurations
    if (environment.services && typeof environment.services === "object") {
      Object.entries(environment.services).forEach(([serviceName, serviceConfig]) => {
        if (serviceConfig && serviceConfig.enabled) {
          data.services[serviceName] = {
            enabled: true,
            ...serviceConfig,
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
