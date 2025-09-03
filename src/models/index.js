// src/models/index.js
const { sequelize } = require('../config/database');

// Import models
const Environment = require('./Environment');
const User = require('./User');

// Define associations
User.hasMany(Environment, {
  foreignKey: 'user_id',
  as: 'environments'
});

Environment.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// Export models and database connection
module.exports = {
  sequelize,
  Environment,
  User
};