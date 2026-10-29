"use strict";

// 20261029120000-scope-job-idempotency-key-to-user.js
// OP-262 (D30): idempotency keys are chosen by the client, and the unique
// index on idempotency_key alone made them global - jobService looked a key
// up across all users and handed another user's jobId and status back. The
// key is now unique per user.
//
// Safe on existing data: every row is already unique on idempotency_key, so
// it is unique on (user_id, idempotency_key) too and the new index cannot
// fail to build. It is built before the old one is dropped, so the key is
// never unconstrained in between, and IF [NOT] EXISTS makes a re-run after a
// partial failure harmless. Jobs are deleted after JOB_RETENTION_DAYS, so the
// table is small and the write lock of a plain CREATE INDEX is brief.
module.exports = {
  async up({ context: queryInterface }) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_user_id_idempotency_key
      ON jobs (user_id, idempotency_key);
    `);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS jobs_idempotency_key;`);
  },

  // Fails if two users have sent the same key since up() ran, which up() exists
  // to allow. The global index is built first, so a failed down() changes nothing.
  async down({ context: queryInterface }) {
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency_key
      ON jobs (idempotency_key);
    `);
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS jobs_user_id_idempotency_key;`);
  },
};
