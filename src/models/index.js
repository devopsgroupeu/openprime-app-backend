// src/models/index.js
const { sequelize } = require("../config/database");

// Import models
const Environment = require("./Environment");
const User = require("./User");
const CloudCredential = require("./CloudCredential");
const Job = require("./Job");

// Define associations
User.hasMany(Environment, {
  foreignKey: "user_id",
  as: "environments",
});

Environment.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

User.hasMany(CloudCredential, {
  foreignKey: "user_id",
  as: "cloudCredentials",
});

CloudCredential.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

Environment.belongsTo(CloudCredential, {
  foreignKey: "cloud_credential_id",
  as: "cloudCredential",
});

CloudCredential.hasMany(Environment, {
  foreignKey: "cloud_credential_id",
  as: "environments",
});

User.hasMany(Job, {
  foreignKey: "user_id",
  as: "jobs",
});

Job.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

Environment.hasMany(Job, {
  foreignKey: "environment_id",
  as: "jobs",
});

Job.belongsTo(Environment, {
  foreignKey: "environment_id",
  as: "environment",
});

// Export models and database connection
module.exports = {
  sequelize,
  Environment,
  User,
  CloudCredential,
  Job,
};
