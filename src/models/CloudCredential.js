const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/database");
const { encryptCredentials, decryptCredentials } = require("../utils/credentialCrypto");

const CloudCredential = sequelize.define(
  "CloudCredential",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "users",
        key: "id",
      },
    },
    provider: {
      type: DataTypes.ENUM("aws", "azure", "gcp", "onpremise"),
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "User-defined name for this credential set",
    },
    identifier: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Account identifier (e.g., AWS Account ID, Azure Subscription ID)",
    },
    credentials: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: "Encrypted credentials JSON",
      get() {
        return decryptCredentials(this.getDataValue("credentials"));
      },
      set(value) {
        try {
          this.setDataValue("credentials", encryptCredentials(value));
        } catch (error) {
          console.error("Error encrypting credentials:", error);
          throw error;
        }
      },
    },
    is_default: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: "Whether this is the default credential for the provider",
    },
    last_validated: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Last time credentials were validated",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "cloud_credentials",
    indexes: [
      {
        fields: ["user_id", "provider"],
      },
      {
        fields: ["user_id", "is_default"],
      },
      {
        unique: true,
        fields: ["user_id", "provider", "name"],
      },
    ],
  },
);

module.exports = CloudCredential;
