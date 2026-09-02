// src/validators/serviceSchema.js
//
// Shared server-side schema validation for the JSONB environment.services
// payload. This is the interim implementation: a static schema mirroring the
// 14 user-facing AWS services defined in the frontend (openprime-app
// src/config/services/aws.js). OP-207 will replace getServiceSchema() with a
// fetch from GET /api/catalog so the schema is derived from the templates
// themselves rather than duplicated here. Call sites — validateServices and
// validateServicesForGeneration — will not change.

/**
 * Field type constants matching the frontend FIELD_TYPES.
 */
const FIELD_TYPES = {
  TEXT: "text",
  NUMBER: "number",
  TOGGLE: "toggle",
  DROPDOWN: "dropdown",
  MULTISELECT: "multiselect",
  TEXTAREA: "textarea",
  ARRAY: "array",
  OBJECT: "object",
};

/**
 * Static schema for the 14 user-facing AWS services.
 *
 * Each service maps to an object with a `fields` property. Each field maps to
 * a descriptor with:
 *   - type: one of FIELD_TYPES
 *   - min/max: numeric bounds (for NUMBER fields)
 *   - requiredWhen: { field, value } — the field is required when a sibling
 *       field equals `value`. Used for conditional fields that have no
 *       template default (e.g. kmsKeyId is required when enableEncryption=true).
 *
 * Dropdown option values and text validation patterns are deliberately
 * omitted: those are the catalog's business (GET /api/catalog), not the
 * backend's. Enforcing them here means the wizard can offer a value the API
 * then rejects — exactly the bug OP-207 fixed.
 *
 * `lambda` is excluded (available: false in the wizard) — the backend should
 * reject lambda configurations until the service is re-enabled.
 */
const STATIC_SCHEMA = {
  vpc: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      cidr: { type: FIELD_TYPES.TEXT },
      azCount: { type: FIELD_TYPES.DROPDOWN },
      createPublicSubnets: { type: FIELD_TYPES.TOGGLE },
      createPrivateSubnets: { type: FIELD_TYPES.TOGGLE },
      createIntraSubnets: { type: FIELD_TYPES.TOGGLE },
      createDatabaseSubnets: { type: FIELD_TYPES.TOGGLE },
      createDatabaseSubnetGroup: { type: FIELD_TYPES.TOGGLE },
      natGateway: { type: FIELD_TYPES.DROPDOWN },
      publicSubnetTags: { type: FIELD_TYPES.OBJECT },
      privateSubnetTags: { type: FIELD_TYPES.OBJECT },
      databaseSubnetTags: { type: FIELD_TYPES.OBJECT },
      enableVpnGateway: { type: FIELD_TYPES.TOGGLE },
      enableFlowLogs: { type: FIELD_TYPES.TOGGLE },
      enableDnsHostnames: { type: FIELD_TYPES.TOGGLE },
      enableDnsSupport: { type: FIELD_TYPES.TOGGLE },
    },
  },
  eks: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      kubernetesVersion: { type: FIELD_TYPES.DROPDOWN },
      enableClusterCreatorAdminPermissions: { type: FIELD_TYPES.TOGGLE },
      endpointPublicAccess: { type: FIELD_TYPES.TOGGLE },
      authenticationMode: { type: FIELD_TYPES.DROPDOWN },
      enableIrsa: { type: FIELD_TYPES.TOGGLE },
      defaultNodeGroupAmiType: { type: FIELD_TYPES.DROPDOWN },
      defaultNodeGroupInstanceTypes: { type: FIELD_TYPES.MULTISELECT },
      defaultNodeGroupCapacityType: { type: FIELD_TYPES.DROPDOWN },
      defaultNodeGroupMinSize: { type: FIELD_TYPES.NUMBER, min: 0, max: 100 },
      defaultNodeGroupMaxSize: { type: FIELD_TYPES.NUMBER, min: 1, max: 100 },
      defaultNodeGroupDesiredSize: { type: FIELD_TYPES.NUMBER, min: 0, max: 100 },
      defaultNodeGroupMaxUnavailable: { type: FIELD_TYPES.NUMBER, min: 1, max: 10 },
      networkPolicyEnable: { type: FIELD_TYPES.TOGGLE },
      karpenterEnabled: { type: FIELD_TYPES.TOGGLE },
      karpenterNodepoolArch: { type: FIELD_TYPES.DROPDOWN },
      karpenterNodepoolCapacityType: { type: FIELD_TYPES.DROPDOWN },
    },
  },
  rds: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      engine: { type: FIELD_TYPES.DROPDOWN },
      version: { type: FIELD_TYPES.TEXT },
      majorEngineVersion: { type: FIELD_TYPES.TEXT },
      family: { type: FIELD_TYPES.TEXT },
      instanceClass: { type: FIELD_TYPES.DROPDOWN },
      allocatedStorage: { type: FIELD_TYPES.NUMBER, min: 20, max: 1000 },
      maxAllocatedStorage: { type: FIELD_TYPES.NUMBER, min: 20, max: 10000 },
      multiAz: { type: FIELD_TYPES.TOGGLE },
      backupRetention: { type: FIELD_TYPES.NUMBER, min: 0, max: 35 },
      backupWindow: { type: FIELD_TYPES.TEXT },
      maintenanceWindow: { type: FIELD_TYPES.TEXT },
      deletionProtection: { type: FIELD_TYPES.TOGGLE },
      skipFinalSnapshot: { type: FIELD_TYPES.TOGGLE },
      applyImmediately: { type: FIELD_TYPES.TOGGLE },
      autoMinorVersionUpgrade: { type: FIELD_TYPES.TOGGLE },
      publiclyAccessible: { type: FIELD_TYPES.TOGGLE },
      iamDatabaseAuthenticationEnabled: { type: FIELD_TYPES.TOGGLE },
      manageMasterUserPassword: { type: FIELD_TYPES.TOGGLE },
      performanceInsights: { type: FIELD_TYPES.TOGGLE },
      performanceInsightsRetentionPeriod: { type: FIELD_TYPES.NUMBER, min: 7, max: 731 },
      monitoringInterval: { type: FIELD_TYPES.DROPDOWN },
      deleteAutomatedBackups: { type: FIELD_TYPES.TOGGLE },
    },
  },
  aurora: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      engine: { type: FIELD_TYPES.DROPDOWN },
      engineVersion: { type: FIELD_TYPES.TEXT },
      instances: { type: FIELD_TYPES.OBJECT },
      serverlessv2MinCapacity: { type: FIELD_TYPES.NUMBER, min: 0, max: 128 },
      serverlessv2MaxCapacity: { type: FIELD_TYPES.NUMBER, min: 0.5, max: 128 },
      serverlessv2SecondsUntilAutoPause: { type: FIELD_TYPES.NUMBER, min: 300, max: 86400 },
      backupRetention: { type: FIELD_TYPES.NUMBER, min: 1, max: 35 },
      deletionProtection: { type: FIELD_TYPES.TOGGLE },
      manageMasterUserPassword: { type: FIELD_TYPES.TOGGLE },
      enableHttpEndpoint: { type: FIELD_TYPES.TOGGLE },
      iamDatabaseAuthenticationEnabled: { type: FIELD_TYPES.TOGGLE },
      monitoringInterval: { type: FIELD_TYPES.DROPDOWN },
      applyImmediately: { type: FIELD_TYPES.TOGGLE },
      skipFinalSnapshot: { type: FIELD_TYPES.TOGGLE },
      deleteAutomatedBackups: { type: FIELD_TYPES.TOGGLE },
    },
  },
  opensearch: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      domainName: { type: FIELD_TYPES.TEXT },
      version: { type: FIELD_TYPES.DROPDOWN },
      instanceType: { type: FIELD_TYPES.DROPDOWN },
      instanceCount: { type: FIELD_TYPES.NUMBER, min: 1, max: 20 },
      dedicatedMasterEnabled: { type: FIELD_TYPES.TOGGLE },
      dedicatedMasterType: { type: FIELD_TYPES.DROPDOWN },
      dedicatedMasterCount: { type: FIELD_TYPES.NUMBER, min: 0, max: 5 },
      ebsEnabled: { type: FIELD_TYPES.TOGGLE },
      ebsVolumeSize: { type: FIELD_TYPES.NUMBER, min: 10, max: 1000 },
      ebsVolumeType: { type: FIELD_TYPES.DROPDOWN },
      customEndpointEnabled: { type: FIELD_TYPES.TOGGLE },
      nodeToNodeEncryption: { type: FIELD_TYPES.TOGGLE },
      enforceHttps: { type: FIELD_TYPES.TOGGLE },
      tlsSecurityPolicy: { type: FIELD_TYPES.DROPDOWN },
      advancedSecurityEnabled: { type: FIELD_TYPES.TOGGLE },
      internalUserDatabaseEnabled: { type: FIELD_TYPES.TOGGLE },
      masterUserName: { type: FIELD_TYPES.TEXT },
      createAccessPolicy: { type: FIELD_TYPES.TOGGLE },
      ipAddressType: { type: FIELD_TYPES.DROPDOWN },
      allowExplicitIndex: { type: FIELD_TYPES.TOGGLE },
    },
  },
  ecr: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      repositoryNames: { type: FIELD_TYPES.ARRAY },
      repositoryType: { type: FIELD_TYPES.DROPDOWN },
      imageTagMutability: { type: FIELD_TYPES.DROPDOWN },
      encryptionType: { type: FIELD_TYPES.DROPDOWN },
      enableScanning: { type: FIELD_TYPES.TOGGLE },
      scanType: { type: FIELD_TYPES.DROPDOWN },
      createLifecyclePolicy: { type: FIELD_TYPES.TOGGLE },
      lifecyclePolicyMaxImages: { type: FIELD_TYPES.NUMBER, min: 1, max: 1000 },
      enableReplication: { type: FIELD_TYPES.TOGGLE },
      replicationDestinations: { type: FIELD_TYPES.ARRAY },
    },
  },
  s3: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      bucketNames: { type: FIELD_TYPES.ARRAY },
    },
  },
  elasticache: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      engine: { type: FIELD_TYPES.DROPDOWN },
      engineVersion: { type: FIELD_TYPES.TEXT },
      nodeType: { type: FIELD_TYPES.DROPDOWN },
      numCacheNodes: { type: FIELD_TYPES.NUMBER, min: 1, max: 20 },
      parameterGroupFamily: { type: FIELD_TYPES.DROPDOWN },
      transitEncryption: { type: FIELD_TYPES.TOGGLE },
      atRestEncryption: { type: FIELD_TYPES.TOGGLE },
      authTokenEnabled: { type: FIELD_TYPES.TOGGLE },
      maintenanceWindow: { type: FIELD_TYPES.TEXT },
      snapshotRetentionLimit: { type: FIELD_TYPES.NUMBER, min: 0, max: 35 },
      snapshotWindow: { type: FIELD_TYPES.TEXT },
      automaticFailover: { type: FIELD_TYPES.TOGGLE },
      multiAz: { type: FIELD_TYPES.TOGGLE },
    },
  },
  msk: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      kafkaVersion: { type: FIELD_TYPES.DROPDOWN },
      numberOfBrokerNodes: { type: FIELD_TYPES.NUMBER, min: 2, max: 30 },
      brokerNodeInstanceType: { type: FIELD_TYPES.DROPDOWN },
    },
  },
  waf: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      name: { type: FIELD_TYPES.TEXT },
      description: { type: FIELD_TYPES.TEXT },
      scope: { type: FIELD_TYPES.DROPDOWN },
      cloudwatchMetricsEnabled: { type: FIELD_TYPES.TOGGLE },
      metricName: { type: FIELD_TYPES.TEXT },
      sampledRequestsEnabled: { type: FIELD_TYPES.TOGGLE },
    },
  },
  sqs: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      queueNames: { type: FIELD_TYPES.ARRAY },
      fifoQueues: { type: FIELD_TYPES.TOGGLE },
      contentBasedDeduplication: { type: FIELD_TYPES.TOGGLE },
      visibilityTimeout: { type: FIELD_TYPES.NUMBER, min: 0, max: 43200 },
      messageRetention: { type: FIELD_TYPES.NUMBER, min: 60, max: 1209600 },
      maxMessageSize: { type: FIELD_TYPES.NUMBER, min: 1024, max: 262144 },
      delaySeconds: { type: FIELD_TYPES.NUMBER, min: 0, max: 900 },
      receiveWaitTime: { type: FIELD_TYPES.NUMBER, min: 0, max: 20 },
      createDeadLetterQueue: { type: FIELD_TYPES.TOGGLE },
      maxReceiveCount: { type: FIELD_TYPES.NUMBER, min: 1, max: 1000 },
      enableEncryption: { type: FIELD_TYPES.TOGGLE },
    },
  },
  sns: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      topicNames: { type: FIELD_TYPES.ARRAY },
      fifoTopics: { type: FIELD_TYPES.TOGGLE },
      contentBasedDeduplication: { type: FIELD_TYPES.TOGGLE },
      enableEncryption: { type: FIELD_TYPES.TOGGLE },
      kmsKeyId: {
        type: FIELD_TYPES.TEXT,
        requiredWhen: { field: "enableEncryption", value: true },
      },
    },
  },
  cloudfront: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      distributionNames: { type: FIELD_TYPES.ARRAY },
      priceClass: { type: FIELD_TYPES.DROPDOWN },
      enableIpv6: { type: FIELD_TYPES.TOGGLE },
      enableWaf: { type: FIELD_TYPES.TOGGLE },
      enableLogging: { type: FIELD_TYPES.TOGGLE },
      loggingBucket: {
        type: FIELD_TYPES.TEXT,
        requiredWhen: { field: "enableLogging", value: true },
      },
    },
  },
  route53: {
    fields: {
      enabled: { type: FIELD_TYPES.TOGGLE },
      zoneNames: { type: FIELD_TYPES.ARRAY },
      privateZones: { type: FIELD_TYPES.TOGGLE },
      forceDestroy: { type: FIELD_TYPES.TOGGLE },
      enableDnssec: { type: FIELD_TYPES.TOGGLE },
    },
  },
};

/**
 * Single accessor for the service schema.
 *
 * Today this returns a static object. OP-207 will replace the body with a
 * fetch from GET /api/catalog (via catalogService) so the schema is derived
 * from the templates themselves. Call sites (validateServices,
 * validateServicesForGeneration) will not change.
 *
 * @returns {Promise<object>} the service schema
 */
async function getServiceSchema() {
  return STATIC_SCHEMA;
}

/**
 * Check whether a value is a plain object (not null, not an array).
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check whether a value matches the expected field type.
 *
 * @returns {boolean} true if the type matches
 */
function checkFieldType(value, expectedType) {
  switch (expectedType) {
    case FIELD_TYPES.TOGGLE:
      return typeof value === "boolean";
    case FIELD_TYPES.NUMBER:
      return typeof value === "number" && !Number.isNaN(value) && Number.isFinite(value);
    case FIELD_TYPES.TEXT:
    case FIELD_TYPES.TEXTAREA:
      return typeof value === "string";
    case FIELD_TYPES.DROPDOWN:
      // Dropdown option values can be strings or numbers (e.g. azCount=2,
      // monitoringInterval=60, engine="postgres"). We accept both but not
      // booleans, objects, or arrays.
      return typeof value === "string" || typeof value === "number";
    case FIELD_TYPES.MULTISELECT:
    case FIELD_TYPES.ARRAY:
      return Array.isArray(value);
    case FIELD_TYPES.OBJECT:
      return isPlainObject(value);
    default:
      return true;
  }
}

/**
 * Validate the full services object structure.
 *
 * Used on create/update to reject malformed payloads early. Checks:
 *   - services is a plain object (not an array, not a string)
 *   - each service key is a known service in the schema
 *   - each service value is a plain object
 *   - each field key is a known field for that service
 *   - each field value matches the expected type
 *   - number fields are within min/max bounds
 *
 * Does NOT check dropdown option values or text validation patterns —
 * those are the catalog's business (GET /api/catalog), not the backend's.
 *
 * For non-AWS providers, only the top-level object check runs (the static
 * schema only covers AWS services).
 *
 * @param {*} services - the services payload from the request body
 * @param {{ provider?: string }} [options]
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 */
async function validateServices(services, { provider } = {}) {
  const errors = [];

  if (services === null || services === undefined) {
    return { valid: true, errors };
  }

  if (!isPlainObject(services)) {
    errors.push("Services must be a plain object");
    return { valid: false, errors };
  }

  // Only validate per-service structure for AWS — the static schema only
  // covers AWS services. OP-207 will make this catalog-driven for all
  // providers.
  if (provider && provider !== "aws") {
    return { valid: true, errors };
  }

  const schema = await getServiceSchema();

  for (const [serviceName, serviceConfig] of Object.entries(services)) {
    if (!(serviceName in schema)) {
      errors.push(`Unknown service "${serviceName}"`);
      continue;
    }

    if (!isPlainObject(serviceConfig)) {
      errors.push(`Service "${serviceName}" must be a plain object`);
      continue;
    }

    const serviceFields = schema[serviceName].fields;

    for (const [fieldName, fieldValue] of Object.entries(serviceConfig)) {
      if (!(fieldName in serviceFields)) {
        errors.push(`Unknown field "${fieldName}" in service "${serviceName}"`);
        continue;
      }

      // null/undefined means the field is not set — that's fine for
      // create/update validation. Generation validation checks required
      // fields separately.
      if (fieldValue === null || fieldValue === undefined) {
        continue;
      }

      const fieldSchema = serviceFields[fieldName];

      if (!checkFieldType(fieldValue, fieldSchema.type)) {
        errors.push(
          `Field "${serviceName}.${fieldName}" must be of type ${fieldSchema.type}, got ${typeof fieldValue}`,
        );
        continue;
      }

      // Range check for number fields
      if (fieldSchema.type === FIELD_TYPES.NUMBER) {
        if (fieldSchema.min !== undefined && fieldValue < fieldSchema.min) {
          errors.push(
            `Field "${serviceName}.${fieldName}" must be >= ${fieldSchema.min}, got ${fieldValue}`,
          );
        }
        if (fieldSchema.max !== undefined && fieldValue > fieldSchema.max) {
          errors.push(
            `Field "${serviceName}.${fieldName}" must be <= ${fieldSchema.max}, got ${fieldValue}`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate the services object before generation.
 *
 * Runs all structural checks from validateServices, then additionally for each
 * enabled service (enabled === true): checks that conditionally required
 * fields (requiredWhen) are present when their dependency is met.
 *
 * Non-boolean enabled values (e.g. "true", 1) are already rejected by the
 * structural pass (TOGGLE type check), so they never reach this function.
 *
 * @param {*} services - the environment's services payload
 * @param {{ provider?: string }} [options]
 * @returns {Promise<{ valid: boolean, errors: string[] }>}
 */
async function validateServicesForGeneration(services, { provider } = {}) {
  const structural = await validateServices(services, { provider });

  if (!structural.valid) {
    return structural;
  }

  if (services === null || services === undefined || !isPlainObject(services)) {
    return { valid: true, errors: [] };
  }

  if (provider && provider !== "aws") {
    return { valid: true, errors: [] };
  }

  const schema = await getServiceSchema();
  const errors = [];

  for (const [serviceName, serviceConfig] of Object.entries(services)) {
    if (!(serviceName in schema) || !isPlainObject(serviceConfig)) {
      continue; // Already caught by structural validation
    }

    // Only check enabled services — disabled services are skipped by
    // prepareInjectoData, so their field values don't reach Injecto.
    if (serviceConfig.enabled !== true) {
      continue;
    }

    // Check conditionally required fields
    const serviceFields = schema[serviceName].fields;
    for (const [fieldName, fieldSchema] of Object.entries(serviceFields)) {
      if (!fieldSchema.requiredWhen) continue;

      const { field: depField, value: depValue } = fieldSchema.requiredWhen;
      const depFieldValue = serviceConfig[depField];

      // The dependency is met when the sibling field equals the required value
      if (depFieldValue === depValue) {
        const fieldValue = serviceConfig[fieldName];
        if (fieldValue === null || fieldValue === undefined || fieldValue === "") {
          errors.push(
            `Field "${serviceName}.${fieldName}" is required when ${serviceName}.${depField} is ${JSON.stringify(depValue)}`,
          );
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  getServiceSchema,
  validateServices,
  validateServicesForGeneration,
  FIELD_TYPES,
};
