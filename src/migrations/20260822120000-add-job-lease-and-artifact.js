"use strict";

// 20260822120000-add-job-lease-and-artifact.js
// Reviewer fixes for the async job model:
//   - claimed_by: lease owner (worker process id) stamped at claim time so a
//     graceful shutdown only requeues THIS worker's in-flight jobs — a rolling
//     restart of one worker can no longer requeue (and double-push) jobs that
//     another worker is actively running.
//   - artifact: generated ZIP bytes stored on the jobs row (BYTEA) instead of
//     local disk, so any API pod can serve the download regardless of which pod
//     ran the job (no shared/PVC filesystem dependency).
module.exports = {
  async up({ context: queryInterface, Sequelize }) {
    await queryInterface.addColumn("jobs", "claimed_by", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("jobs", "artifact", {
      type: Sequelize.BLOB,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down({ context: queryInterface }) {
    await queryInterface.removeColumn("jobs", "artifact");
    await queryInterface.removeColumn("jobs", "claimed_by");
  },
};
