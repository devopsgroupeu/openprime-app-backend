"use strict";

// 20260819120000-create-jobs-table.js
// Async job queue for generate/push (P1 architecture task).
//
// Jobs are DB-backed (no Redis in the stack): the API enqueues a row and
// returns 202 + jobId, an in-process worker claims rows with
// SELECT ... FOR UPDATE SKIP LOCKED, and the UI polls GET /api/jobs/:jobId.
//
// Concurrency controls live in this schema:
//   - idempotency_key UNIQUE  -> replaying a request returns the same job
//   - jobs_active_env_lock    -> at most one active (queued/running) job per
//                                (type, environment_id)
//   - jobs_active_repo_lock   -> at most one active push per (repo_url, branch)
//                                across ALL environments — concurrent pushes to
//                                the same repo can corrupt it
module.exports = {
  async up({ context: queryInterface, Sequelize }) {
    await queryInterface.createTable("jobs", {
      id: { type: Sequelize.UUID, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      type: { type: Sequelize.ENUM("generate", "push"), allowNull: false },
      status: {
        type: Sequelize.ENUM("queued", "running", "succeeded", "failed", "cancelled"),
        allowNull: false,
        defaultValue: "queued",
      },
      environment_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: "environments", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      // Snapshot of the environment at enqueue time so later edits (or even a
      // delete) cannot change what a queued job builds.
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      result: { type: Sequelize.JSONB, allowNull: true, defaultValue: null },
      error: { type: Sequelize.TEXT, allowNull: true, defaultValue: null },
      idempotency_key: { type: Sequelize.STRING, allowNull: true, defaultValue: null },
      repo_url: { type: Sequelize.STRING, allowNull: true, defaultValue: null },
      branch: { type: Sequelize.STRING, allowNull: true, defaultValue: null },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      max_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 3 },
      next_attempt_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
      started_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
      finished_at: { type: Sequelize.DATE, allowNull: true, defaultValue: null },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
    });

    await queryInterface.addIndex("jobs", ["status"]);
    await queryInterface.addIndex("jobs", ["environment_id"]);
    await queryInterface.addIndex("jobs", ["user_id"]);
    await queryInterface.addIndex("jobs", ["next_attempt_at"]);
    await queryInterface.addIndex("jobs", ["idempotency_key"], { unique: true });

    // Partial unique indexes = the DB-enforced locks (raw SQL: queryInterface
    // does not support partial index `where` clauses reliably).
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX jobs_active_env_lock
      ON jobs (type, environment_id)
      WHERE status IN ('queued', 'running');
    `);
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX jobs_active_repo_lock
      ON jobs (repo_url, branch)
      WHERE status IN ('queued', 'running') AND type = 'push';
    `);
  },

  async down({ context: queryInterface }) {
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS jobs_active_repo_lock;`);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS jobs_active_env_lock;`);
    await queryInterface.dropTable("jobs");
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS enum_jobs_type;`);
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS enum_jobs_status;`);
  },
};
