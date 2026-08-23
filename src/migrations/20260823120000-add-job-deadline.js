"use strict";

// 20260823120000-add-job-deadline.js
// Reviewer fix A4: add a DB-backed deadline column so hung jobs are detected
// across restarts and the worker never claims an already-expired job.
//
// The deadline is set at enqueue time (NOW() + JOB_DEADLINE_MS). The worker
// checks it before executing and skips (eventually fails) expired jobs.
module.exports = {
  async up({ context: queryInterface, Sequelize }) {
    await queryInterface.addColumn("jobs", "deadline", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
      comment: "Jobs past this timestamp are considered expired and must not be claimed",
    });
  },

  async down({ context: queryInterface }) {
    await queryInterface.removeColumn("jobs", "deadline");
  },
};