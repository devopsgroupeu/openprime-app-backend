"use strict";

// 20260819120001-add-environment-job-outcomes.js
// Persists the last generate/push outcome on the environment so the UI (and
// operators) can see "what happened last time" without scanning the jobs table.
// Columns are NULL until the first job of that type finishes.
module.exports = {
  async up({ context: queryInterface, Sequelize }) {
    await queryInterface.addColumn("environments", "last_generate_at", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("environments", "last_generate_status", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("environments", "last_generate_error", {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("environments", "last_push_at", {
      type: Sequelize.DATE,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("environments", "last_push_status", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("environments", "last_push_error", {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
    await queryInterface.addColumn("environments", "last_push_commit", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down({ context: queryInterface }) {
    await queryInterface.removeColumn("environments", "last_push_commit");
    await queryInterface.removeColumn("environments", "last_push_error");
    await queryInterface.removeColumn("environments", "last_push_status");
    await queryInterface.removeColumn("environments", "last_push_at");
    await queryInterface.removeColumn("environments", "last_generate_error");
    await queryInterface.removeColumn("environments", "last_generate_status");
    await queryInterface.removeColumn("environments", "last_generate_at");
  },
};
