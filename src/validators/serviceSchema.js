// src/validators/serviceSchema.js
//
// Shared server-side schema validation for the JSONB environment.services
// payload. The schema is derived from the same runtime catalog document the
// wizard renders from (catalogService.getCatalog() → GET /api/catalog), so
// the API cannot reject a value the wizard offers — both sides read one
// doc and cannot drift apart.
//
// Only the REQUIRED_WHEN overlay below is hand-maintained: the catalog
// cannot express conditional requirements (e.g. kmsKeyId is required when
// enableEncryption=true).
//
// If the catalog is unreachable, per-service checks are skipped (fail-open)
// rather than rejecting payloads we cannot verify — rejecting values the
// wizard may well be offering is the exact failure mode OP-207 fixed.
// Injecto still validates every value at generation time, so fail-open
// never lets a bad value through to the templates.

const { getCatalog } = require("../services/catalogService");
const { logger } = require("../utils/logger");

/**
 * Field type constants matching the catalog's control types (and the
 * frontend FIELD_TYPES).
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
 * Conditional requirements the catalog cannot express. Each entry makes the
 * field required when the sibling field equals `value`.
 */
const REQUIRED_WHEN = {
  sns: {
    kmsKeyId: { field: "enableEncryption", value: true },
  },
  cloudfront: {
    loggingBucket: { field: "enableLogging", value: true },
  },
};

/**
 * Map a catalog field descriptor to a control type for checkFieldType.
 *
 * The catalog carries `type` (the UI control: toggle/text/dropdown/…) which
 * matches FIELD_TYPES 1:1. When a field lacks it, fall back to `valueType`
 * (the data type: string/number/boolean). Unknown descriptors get undefined,
 * which checkFieldType treats as "accept any value" — never a rejection the
 * catalog did not ask for.
 */
function controlTypeFor(field) {
  if (typeof field.type === "string" && field.type) {
    return field.type;
  }
  switch (field.valueType) {
    case "boolean":
      return FIELD_TYPES.TOGGLE;
    case "number":
      return FIELD_TYPES.NUMBER;
    case "array":
    case "list":
      return FIELD_TYPES.ARRAY;
    case "string":
      return FIELD_TYPES.TEXT;
    default:
      return undefined;
  }
}

/**
 * Catalog min/max arrive as strings ("0", "100"). Coerce to finite numbers;
 * anything else (missing, empty, non-numeric) means "no bound".
 */
function coerceBound(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Transform a catalog document into the shape validateServices consumes:
 * { [service]: { fields: { [field]: { type, min?, max?, requiredWhen? } } } }.
 *
 * Dropdown option values and text validation patterns are deliberately not
 * enforced: the catalog serves them for the wizard UI, but re-checking them
 * here would duplicate the catalog's business. Structural type and bounds
 * checks catch malformed payloads; Injecto catches bad values at generation.
 */
function transformCatalogDoc(doc) {
  const services = (doc && doc.services) || {};
  const schema = {};

  for (const [serviceKey, service] of Object.entries(services)) {
    const catalogFields = (service && service.fields) || {};
    const fields = {};

    for (const [fieldName, field] of Object.entries(catalogFields)) {
      const descriptor = { type: controlTypeFor(field) };
      const min = coerceBound(field.min);
      const max = coerceBound(field.max);
      if (min !== undefined) descriptor.min = min;
      if (max !== undefined) descriptor.max = max;
      fields[fieldName] = descriptor;
    }

    // Overlay hand-maintained conditional requirements — only onto fields
    // the catalog actually serves, so we never require something the
    // wizard cannot offer.
    const overlay = REQUIRED_WHEN[serviceKey];
    if (overlay) {
      for (const [fieldName, requiredWhen] of Object.entries(overlay)) {
        if (fields[fieldName]) {
          fields[fieldName].requiredWhen = requiredWhen;
        }
      }
    }

    schema[serviceKey] = { fields };
  }

  return schema;
}

// Cache keyed by the catalog etag (the templates commit sha): the same doc
// always transforms to the same schema, so we transform once per commit.
let schemaCache = { key: null, schema: null };

/**
 * Single accessor for the service schema.
 *
 * Derives it from the runtime catalog (catalogService.getCatalog()), so the
 * schema and the wizard read one document and cannot drift apart. Throws
 * when the catalog is unavailable — callers that can tolerate that (the
 * validators below) should use loadSchema() instead.
 *
 * @returns {Promise<object>} the service schema
 */
async function getServiceSchema() {
  const { doc, etag } = await getCatalog();

  if (schemaCache.schema && schemaCache.key === etag) {
    return schemaCache.schema;
  }

  const schema = transformCatalogDoc(doc);
  schemaCache = { key: etag, schema };
  return schema;
}

/**
 * Test seam — drop the transformed-schema cache so the next
 * getServiceSchema() call re-reads the (possibly re-mocked) catalog.
 */
function resetSchemaCache() {
  schemaCache = { key: null, schema: null };
}

/**
 * Load the schema for validation, failing open when it cannot be loaded.
 *
 * @returns {Promise<object|null>} the schema, or null to skip per-service
 *   validation (Injecto still validates at generation time)
 */
async function loadSchema() {
  try {
    const schema = await getServiceSchema();
    if (!schema || Object.keys(schema).length === 0) {
      logger.warn("Service validation skipped — catalog document has no services");
      return null;
    }
    return schema;
  } catch (error) {
    logger.warn("Service validation skipped — catalog unavailable", {
      code: error.code,
      message: error.message,
    });
    return null;
  }
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
 * For non-AWS providers, only the top-level object check runs (the catalog
 * currently only covers AWS services).
 *
 * If the catalog is unreachable, per-service checks are skipped (fail-open)
 * rather than rejecting payloads we cannot verify.
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

  // Only validate per-service structure for AWS — the catalog currently
  // only covers AWS services.
  if (provider && provider !== "aws") {
    return { valid: true, errors };
  }

  const schema = await loadSchema();
  if (!schema) {
    return { valid: true, errors };
  }

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
 * If the catalog is unreachable, per-service checks (including requiredWhen)
 * are skipped — Injecto still validates every value at generation time.
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

  const schema = await loadSchema();
  if (!schema) {
    return { valid: true, errors: [] };
  }

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
  resetSchemaCache,
  FIELD_TYPES,
};
