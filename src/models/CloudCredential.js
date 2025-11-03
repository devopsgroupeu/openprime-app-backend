const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

const CloudCredential = sequelize.define('CloudCredential', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  provider: {
    type: DataTypes.ENUM('aws', 'azure', 'gcp', 'onpremise'),
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'User-defined name for this credential set'
  },
  identifier: {
    type: DataTypes.STRING,
    allowNull: false,
    comment: 'Account identifier (e.g., AWS Account ID, Azure Subscription ID)'
  },
  credentials: {
    type: DataTypes.TEXT,
    allowNull: false,
    comment: 'Encrypted credentials JSON',
    get() {
      const encrypted = this.getDataValue('credentials');
      if (!encrypted) return null;

      try {
        const parts = encrypted.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = Buffer.from(parts[2], 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
      } catch (error) {
        console.error('Error decrypting credentials:', error);
        return null;
      }
    },
    set(value) {
      try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);

        let encrypted = cipher.update(JSON.stringify(value), 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag();
        const encryptedValue = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;

        this.setDataValue('credentials', encryptedValue);
      } catch (error) {
        console.error('Error encrypting credentials:', error);
        throw error;
      }
    }
  },
  is_default: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether this is the default credential for the provider'
  },
  last_validated: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Last time credentials were validated'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'cloud_credentials',
  indexes: [
    {
      fields: ['user_id', 'provider']
    },
    {
      fields: ['user_id', 'is_default']
    },
    {
      unique: true,
      fields: ['user_id', 'provider', 'name']
    }
  ]
});

module.exports = CloudCredential;
