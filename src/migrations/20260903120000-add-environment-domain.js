"use strict";

// 20260903120000-add-environment-domain.js
// Adds a nullable domain column to environments. The generated ingresses used to
// hardcode openprime.io — our domain inside the customer's account — so ArgoCD
// never got a certificate and the monitoring hosts resolved for nobody (OP-244).
// Existing rows stay NULL, which the templates read as "ship no host-based
// ingress at all", i.e. strictly less than they emit today.
module.exports = {
  async up({ context: queryInterface, Sequelize }) {
    await queryInterface.addColumn("environments", "domain", {
      type: Sequelize.STRING,
      allowNull: true,
      defaultValue: null,
    });
  },

  async down({ context: queryInterface }) {
    await queryInterface.removeColumn("environments", "domain");
  },
};
