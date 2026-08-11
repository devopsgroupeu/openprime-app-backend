// src/models/Environment.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const {
  encryptGitRepository,
  decryptGitRepository,
  redactGitRepository,
} = require("../utils/sshKey");

const Environment = sequelize.define(
  "Environment",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 255],
      },
    },
    global_prefix: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "op-",
      validate: {
        notEmpty: true,
        len: [1, 50],
      },
      comment: "Global prefix used for all resource names in generated infrastructure",
    },
    provider: {
      type: DataTypes.ENUM("aws", "azure", "gcp", "onpremise"),
      allowNull: false,
      defaultValue: "aws",
    },
    region: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    location: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("pending", "deploying", "running", "stopped", "failed", "destroyed"),
      allowNull: false,
      defaultValue: "pending",
    },
    services: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    terraform_backend: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
      comment: "Terraform backend configuration (S3, DynamoDB)",
    },
    git_repository: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
      comment: "Git repository configuration (URL, encrypted SSH key)",
      // Only `sshKey` is encrypted, not the whole blob: `url` and `branch` stay
      // readable JSONB so support can inspect where an environment pushes
      // without holding the key. The instance getter returns plaintext for the
      // push path; toJSON() below is what keeps it off the wire.
      get() {
        return decryptGitRepository(this.getDataValue("git_repository"));
      },
      set(value) {
        this.setDataValue("git_repository", encryptGitRepository(value));
      },
    },
    state_key: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
      comment:
        "Per-environment Terraform state key prefix (env/<id>). NULL = legacy fixed key (aws.tfstate) for environments created before this column existed.",
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      comment: "User who owns this environment",
    },
    cloud_credential_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: "cloud_credentials",
        key: "id",
      },
      comment: "Cloud credentials used for this environment",
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "environments",
    indexes: [
      {
        fields: ["name"],
      },
      {
        fields: ["provider"],
      },
      {
        fields: ["status"],
      },
      {
        fields: ["created_at"],
      },
      {
        fields: ["user_id"],
      },
    ],
  },
);

/**
 * The customer's deploy key is write-capable against their infrastructure repo,
 * so it must never leave the process in a serialised environment. Redacting in
 * toJSON() rather than at each call site means every current and future read
 * path — list, get, create, update, and anything that JSON.stringify's an
 * instance — is safe by construction; leaking requires deliberately reaching
 * for gitRepositoryWithKey() below.
 */
Environment.prototype.toJSON = function toJSON() {
  const values = { ...this.get({ plain: true }) };
  values.git_repository = redactGitRepository(values.git_repository);
  return values;
};

/**
 * The one sanctioned way to obtain the decrypted deploy key — used by the push
 * path, which has to hand it to git. Named so that any future call site shows
 * up in a grep for the key material.
 */
Environment.prototype.gitRepositoryWithKey = function gitRepositoryWithKey() {
  return this.git_repository;
};

module.exports = Environment;
