// src/models/Environment.js
const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Environment = sequelize.define('Environment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 255]
    }
  },
  provider: {
    type: DataTypes.ENUM('aws', 'azure', 'gcp', 'onpremise'),
    allowNull: false,
    defaultValue: 'aws'
  },
  region: {
    type: DataTypes.STRING,
    allowNull: true
  },
  location: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'deploying', 'running', 'stopped', 'failed', 'destroyed'),
    allowNull: false,
    defaultValue: 'pending'
  },
  services: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {}
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    },
    comment: 'User who owns this environment'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'environments',
  indexes: [
    {
      fields: ['name']
    },
    {
      fields: ['provider']
    },
    {
      fields: ['status']
    },
    {
      fields: ['created_at']
    },
    {
      fields: ['user_id']
    }
  ]
});

module.exports = Environment;