// src/models/Job.js
const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");

// Async job queue for generate/push. Schema is owned by the migrations
// (src/migrations/20260819120000-create-jobs-table.js); the index definitions
// below mirror the DB-enforced locks for documentation purposes.
const Job = sequelize.define(
  "Job",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    type: {
      type: DataTypes.ENUM("generate", "push"),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("queued", "running", "succeeded", "failed", "cancelled"),
      allowNull: false,
      defaultValue: "queued",
    },
    environment_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "environments", key: "id" },
      comment: "Environment this job generates/pushes for",
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "users", key: "id" },
      comment: "User who enqueued the job (scopes job reads)",
    },
    payload: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
      comment: "Environment snapshot at enqueue time — the job builds this, not the live row",
    },
    result: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: null,
      comment: "Outcome on success (message, downloadUrl, commit, ...)",
    },
    error: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
      comment: "Final error message when the job failed",
    },
    deadline: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      comment: "Jobs past this timestamp are expired and must not be claimed or executed",
    },
    claimed_by: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
      comment: "Worker process id that claimed this job (lease owner)",
    },
    artifact: {
      type: DataTypes.BLOB,
      allowNull: true,
      defaultValue: null,
      comment: "Generated ZIP bytes (generate jobs) — stored in DB, not on disk",
    },
    idempotency_key: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
      comment: "Client-supplied key; replaying it returns the same job",
    },
    repo_url: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
      comment: "User repo URL (push jobs) — used for the per-repo lock",
    },
    branch: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
      comment: "Target branch (push jobs) — used for the per-repo lock",
    },
    attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    max_attempts: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 3,
    },
    next_attempt_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
      comment: "Earliest time a queued job may be claimed (retry backoff)",
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
    finished_at: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
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
    tableName: "jobs",
    indexes: [
      { fields: ["status"] },
      { fields: ["environment_id"] },
      { fields: ["user_id"] },
      { fields: ["next_attempt_at"] },
      { fields: ["idempotency_key"], unique: true },
      // Mirrors the DB partial unique indexes (see migration):
      //   jobs_active_env_lock  (type, environment_id) WHERE status IN ('queued','running')
      //   jobs_active_repo_lock (repo_url, branch) WHERE status IN ('queued','running') AND type='push'
    ],
  },
);

module.exports = Job;
