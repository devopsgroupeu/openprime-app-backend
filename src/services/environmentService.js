// src/services/environmentService.js
const yaml = require("js-yaml");
const axios = require("axios");
const { logger } = require("../utils/logger");
const { getRequestId } = require("../utils/requestContext");
const { Environment } = require("../models");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const simpleGit = require("simple-git");
const { validateGitRepositoryUrl } = require("../validators/gitUrl");
const { parseGenerationFailure, generationError } = require("../utils/generationErrors");
const { mergeGitRepository } = require("../utils/sshKey");

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
        domain: data.domain || null,
        status: "pending",
        services: data.services || {},
        terraform_backend: data.terraformBackend || null,
        git_repository: data.gitRepository || null,
        user_id: data.user_id || null,
        cloud_credential_id: data.cloudCredentialId || null,
      };

      const environment = await Environment.create(environmentData);

      // Scope the Terraform state key to this environment so a deleted+recreated
      // (or same-named) environment cannot silently adopt the previous one's
      // state and plan destruction of still-live infrastructure.
      await environment.update({ state_key: `env/${environment.id}` });

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

  /**
   * Decrypted git repository config, including the deploy key, for the push
   * path only — everything else must go through getEnvironmentByIdAndUser,
   * whose toJSON() redacts the key. Still user-scoped: a caller cannot reach
   * another user's key through it.
   */
  async getGitRepositoryForPush(environmentId, userId) {
    const environment = await Environment.findOne({
      where: { id: environmentId, user_id: userId },
    });

    return environment ? environment.gitRepositoryWithKey() : null;
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

      // name and global_prefix are baked into every generated Terraform resource
      // name, so changing them on an existing environment turns the next apply
      // into a full destroy/recreate. They are immutable: an identical value (or
      // none) is accepted so the wizard can post the whole environment back, but
      // a differing value is rejected rather than silently ignored.
      const immutable = { name: "name", globalPrefix: "global_prefix" };
      for (const [field, column] of Object.entries(immutable)) {
        const submitted = data[field];
        if (submitted !== undefined && submitted !== environment[column]) {
          const error = new Error(`${field} cannot be changed after the environment is created`);
          error.status = 400;
          throw error;
        }
      }

      const updateData = {
        name: environment.name,
        global_prefix: environment.global_prefix,
        provider: data.provider || data.type,
        region: data.region,
        location: data.location || data.region,
        // Editable on purpose: a customer typically delegates a domain after
        // trying the product and should not have to recreate the environment to
        // add one. Omitting the field keeps the current value; sending "" clears
        // it, which the templates read as "no host-based ingresses".
        domain: data.domain !== undefined ? data.domain || null : environment.domain,
        services: data.services,
        terraform_backend:
          data.terraformBackend !== undefined
            ? data.terraformBackend
            : environment.terraform_backend,
        git_repository: mergeGitRepository(environment.git_repository, data.gitRepository),
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
      const serviceToken = process.env.SERVICE_TOKEN;

      // Prepare configuration data for Injecto
      const configData = this.prepareInjectoData(environment);

      logger.info("Calling Injecto service", {
        url: `${injectoUrl}/process-git-download`,
        environmentId: environment.id,
      });
      const { gitRepository: _gitRepository, ...configDataNoGit } = configData;
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
            ...(serviceToken && { "X-Service-Token": serviceToken }),
            ...(getRequestId() && { "X-Request-ID": getRequestId() }),
          },
        },
      );

      logger.info("Infrastructure generated", { environmentId: environment.id });
      return Buffer.from(response.data);
    } catch (error) {
      // A 422 means Injecto processed the templates but refused to hand over the
      // result because it would have been silently wrong. That carries a code the
      // user can act on; anything else stays a 500 (OP-214).
      const failure =
        error.response?.status === 422 ? parseGenerationFailure(error.response.data) : null;

      logger.error("Injecto service call failed", {
        error: error.message,
        environmentId: environment.id,
        status: error.response?.status,
        generationFailureCode: failure?.code,
        generationFailureDetails: failure?.details,
      });

      if (failure) {
        throw generationError(failure);
      }

      throw new Error(`Failed to generate infrastructure: ${error.message}`, {
        cause: error,
      });
    }
  }

  async pushInfrastructure(zipBuffer, git_repository, options = {}) {
    // Per-command timeout so a hung clone/commit/push cannot block the worker
    // forever (the job deadline is the outer bound). Default 60s per command.
    const timeoutMs = options.timeoutMs || 60000;

    // Create temporary dir
    logger.info("Creating temp directories");
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openprime-push-dir-"));
    const gitDir = path.join(tempDir, "git");
    const extractDir = path.join(tempDir, "extract");
    const keyDir = path.join(tempDir, "ssh_key");
    const knownHostsFile = path.join(tempDir, "known_hosts");

    try {
      // Git config - key
      // git key refactor
      const sshKey = git_repository.sshKey.replace(/\\n/g, "\n").trim() + "\n";
      await fs.promises.writeFile(keyDir, sshKey, { mode: 0o600 });

      // Validated again at the point of use, not only at the API boundary: an
      // environment stored before the validator existed still reaches this line.
      const urlCheck = validateGitRepositoryUrl(git_repository.url);
      if (!urlCheck.valid) {
        throw new Error(`Invalid repository URL: ${urlCheck.reason}`);
      }

      const git = simpleGit({ timeout: { block: timeoutMs } }).env({
        ...process.env,
        // accept-new trusts a host we have never seen and pins it for the rest
        // of this push; `no` would also accept a *changed* key, which is the
        // shape of a man-in-the-middle. The known_hosts file lives in the temp
        // dir and dies with it, so this is per-push trust-on-first-use.
        GIT_SSH_COMMAND: `ssh -i ${keyDir} -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${knownHostsFile}`,
        // Defence in depth behind the validator: even if a URL slips through,
        // git itself will refuse any transport outside this list — including
        // file:// and bare local paths, which clone happily by default.
        GIT_ALLOW_PROTOCOL: "https:ssh",
      });

      // Clone user repo
      logger.info("Cloning user repository", { url: git_repository.url });
      await git.clone(git_repository.url, gitDir);
      await git.cwd(gitDir);

      // Land on the branch the user configured. Until now the clone's default
      // branch was pushed while the configured branch was used only as the
      // ArgoCD targetRevision, so any branch other than the default produced
      // "pushed successfully" plus a cluster pointed at a branch that never
      // received the commit.
      const targetBranch = git_repository.branch?.trim();
      if (targetBranch && targetBranch !== "HEAD") {
        const remotes = await git.branch(["-r"]);
        const existsRemotely = remotes.all.includes(`origin/${targetBranch}`);
        try {
          if (existsRemotely) {
            await git.checkout(targetBranch);
          } else {
            // New branch off whatever the clone landed on, so the generated
            // tree is added to the repository's history rather than orphaned.
            await git.checkoutLocalBranch(targetBranch);
          }
        } catch (error) {
          throw new Error(
            `Could not use branch "${targetBranch}": ${error.message}. ` +
              `Fix the branch in the environment's Git settings, or create it in the repository first.`,
            { cause: error },
          );
        }
        logger.info("Checked out target branch", {
          branch: targetBranch,
          created: !existsRemotely,
        });
      }

      // Extract zip
      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(extractDir, true);

      // Copy extracted files to cloned repo dir
      await fs.promises.cp(extractDir, gitDir, { recursive: true });

      // Git identity + stage
      await git.addConfig("user.email", "generated_by@openprime.com");
      await git.addConfig("user.name", "OpenPrime");
      await git.add(".");

      // Check if there are changes
      const status = await git.status();
      if (status.isClean()) {
        logger.info("No changes to commit — repository is already up to date");
        return {
          status: "success",
          message: "Repository is already up to date",
          upToDate: true,
          commit: null,
        };
      }

      // Files that already existed and this push changed. `fs.cp` overwrites
      // silently, so without reporting these the user has no way to know the
      // generated tree landed on top of something of theirs.
      const overwritten = [...status.modified, ...status.renamed.map((r) => r.from)].sort();
      if (overwritten.length > 0) {
        logger.warn("Push overwrites existing repository files", {
          count: overwritten.length,
          files: overwritten.slice(0, 20),
        });
      }

      // Push
      await git.commit("Generated infrastructure with OpenPrime");
      const pushArgs =
        targetBranch && targetBranch !== "HEAD" ? ["-u", "origin", targetBranch] : [];
      await git.push(pushArgs);

      // Capture the pushed commit for the job result / last_push_commit.
      let commit = null;
      try {
        commit = (await git.revparse(["HEAD"])).trim();
      } catch {
        // revparse is best-effort; the push itself already succeeded.
      }

      return {
        status: "success",
        message: "Infrastructure pushed to Git",
        branch: targetBranch || null,
        overwritten,
        upToDate: false,
        commit,
      };
    } catch (error) {
      logger.error("Failed to push to Git", { error: error.message });
      throw new Error(`Failed to push to Git: ${error.message}`, { cause: error });
    } finally {
      // Cleanup
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  prepareInjectoData(environment) {
    // Transform environment configuration to Injecto-compatible format

    // Per-environment Terraform state keys. NULL state_key = an environment
    // created before this scoping existed -> keep the legacy fixed keys so its
    // already-deployed state stays reachable.
    const stateKeyPrefix = environment.state_key || null;
    const awsStateKey = stateKeyPrefix ? `${stateKeyPrefix}/aws.tfstate` : "aws.tfstate";
    const kubernetesStateKey = stateKeyPrefix
      ? `${stateKeyPrefix}/kubernetes.tfstate`
      : "kubernetes.tfstate";

    const terraformBackend = environment.terraform_backend
      ? {
          ...environment.terraform_backend,
          // Always use S3 native locking (Terraform 1.11+)
          useLockfile: true,
          // Set encrypt to true by default if not set
          encrypt:
            environment.terraform_backend.encrypt !== undefined
              ? environment.terraform_backend.encrypt
              : true,
          // Scoped state keys substituted into the generated backend blocks
          awsStateKey,
          kubernetesStateKey,
        }
      : null;

    const data = {
      name: environment.name,
      globalPrefix: environment.global_prefix || environment.globalPrefix || "",
      provider: environment.provider,
      region: environment.region || environment.location,
      // @param domain. Empty is a valid answer, not a missing one: the templates
      // emit no host-based ingress for it. Leaving the key out instead would
      // make it an unresolved @param, and an unresolved @param ships the
      // template's own default — which is how our domain reached customers.
      domain: environment.domain || "",
      terraformBackend,
      backend: environment.terraform_backend?.enabled || false,
      // Only the two fields templates actually consume (@param gitRepository.url
      // and .branch). Passing the whole object used to ship the customer's
      // private deploy key across the service boundary to Injecto on every
      // generate, where nothing has ever read it.
      gitRepository: environment.git_repository
        ? {
            url: environment.git_repository.url || "",
            branch: environment.git_repository.branch || "HEAD",
            // The generated workflow filters `on.push.branches`, which YAML needs
            // as a sequence. Injecto renders a list as JSON, so the array form
            // substitutes into `branches: [...]` while the scalar above keeps
            // serving `targetRevision`. Without it the pipeline stayed pinned to
            // main and never fired for any other branch (OP-235).
            branches: [environment.git_repository.branch || "HEAD"],
          }
        : null,
      // Map user-supplied git repo URL into the path Injecto uses for @param argocd.git_repo_url
      argocd: {
        git_repo_url: environment.git_repository?.url || "",
        targetRevision: environment.git_repository?.branch || "HEAD",
        git_target_revision: environment.git_repository?.branch || "HEAD",
        keycloak_url: process.env.KEYCLOAK_URL || "http://keycloak:8080",
      },
      services: {},
    };

    // Extract enabled services with their configurations
    if (environment.services && typeof environment.services === "object") {
      Object.entries(environment.services).forEach(([serviceName, serviceConfig]) => {
        if (serviceConfig?.enabled) {
          data.services[serviceName] = {
            enabled: true,
            ...serviceConfig,
          };
        }
      });
    }

    return data;
  }
}

module.exports = new EnvironmentService();
