"use strict";

// 20260711120000-add-environment-state-key.js
// Adds a nullable state_key column to environments. New environments get a
// per-environment Terraform state key prefix ("env/<id>"); existing rows stay
// NULL and fall back to the legacy fixed "aws.tfstate"/"kubernetes.tfstate"
// keys, so already-deployed environments keep reading their existing state.
module.exports = {
  async up({ context: queryInterface, Sequelize }) {
    await queryInterface.addColumn("environments", "state_key", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down({ context: queryInterface }) {
    await queryInterface.removeColumn("environments", "state_key");
  },
};
