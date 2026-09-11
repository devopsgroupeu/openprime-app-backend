// tests/serviceSchema.test.js
//
// Tests for the shared server-side service schema validation
// (src/validators/serviceSchema.js), which derives its schema from the
// runtime catalog (catalogService.getCatalog() → tests/fixtures/catalogDoc.js
// via the global setup.js mock).
//
// Covers: catalog-derived schema shape (getServiceSchema), structural
// validation for create/update (validateServices), structural +
// conditional required-field validation for generation
// (validateServicesForGeneration), fail-open behavior when the catalog is
// unreachable, and a parity test pinning the schema to the catalog document
// so the two cannot drift apart.
const {
  getServiceSchema,
  validateServices,
  validateServicesForGeneration,
  resetSchemaCache,
} = require("../src/validators/serviceSchema");
const catalogService = require("../src/services/catalogService");
const catalogDoc = require("./fixtures/catalogDoc");

const AWS = { provider: "aws" };

// A representative set of AWS services with correctly-typed values, using
// only fields the fixture catalog serves.
function validAwsServices() {
  return {
    vpc: { enabled: true, cidr: "10.0.0.0/16", azCount: 2 },
    eks: {
      enabled: true,
      kubernetesVersion: "1.34",
      defaultNodeGroupMinSize: 2,
      defaultNodeGroupMaxSize: 4,
    },
    rds: { enabled: true, engine: "postgres", version: "15.4", allocatedStorage: 100 },
  };
}

beforeEach(() => {
  resetSchemaCache();
  catalogService.getCatalog.mockReset();
  catalogService.getCatalog.mockResolvedValue({ doc: catalogDoc, etag: '"fixture-1"' });
});

describe("getServiceSchema — catalog-derived schema", () => {
  it("returns every catalog service, including lambda", async () => {
    const schema = await getServiceSchema();
    expect(Object.keys(schema).sort()).toEqual(Object.keys(catalogDoc.services).sort());
    expect(schema).toHaveProperty("lambda");
  });

  it("gives every service a non-empty fields object", async () => {
    const schema = await getServiceSchema();
    for (const [serviceName, service] of Object.entries(schema)) {
      expect(service).toHaveProperty("fields");
      expect(typeof service.fields).toBe("object");
      expect(service.fields).not.toBeNull();
      expect(Array.isArray(service.fields)).toBe(false);
      expect(Object.keys(service.fields).length).toBeGreaterThan(0);
    }
  });

  it("coerces catalog min/max strings to numbers", async () => {
    const schema = await getServiceSchema();
    expect(schema.eks.fields.defaultNodeGroupMinSize).toMatchObject({ min: 0, max: 100 });
    expect(schema.eks.fields.defaultNodeGroupMaxSize).toMatchObject({ min: 1, max: 100 });
    expect(schema.msk.fields.numberOfBrokerNodes).toMatchObject({ min: 2, max: 30 });
    expect(schema.rds.fields.allocatedStorage).toMatchObject({ min: 20, max: 1000 });
  });

  it("omits bounds when the catalog field has none", async () => {
    const schema = await getServiceSchema();
    const enabled = schema.vpc.fields.enabled;
    expect(enabled).not.toHaveProperty("min");
    expect(enabled).not.toHaveProperty("max");
  });

  it("maps catalog control types 1:1", async () => {
    const schema = await getServiceSchema();
    expect(schema.eks.fields.networkPolicyEnabled.type).toBe("toggle");
    expect(schema.vpc.fields.azCount.type).toBe("dropdown");
    expect(schema.vpc.fields.cidr.type).toBe("text");
    expect(schema.vpc.fields.publicSubnetTags.type).toBe("object");
    expect(schema.sns.fields.topicNames.type).toBe("array");
  });

  it("overlays requiredWhen onto fields the catalog serves", async () => {
    const schema = await getServiceSchema();
    expect(schema.sns.fields.kmsKeyId.requiredWhen).toEqual({
      field: "enableEncryption",
      value: true,
    });
    expect(schema.cloudfront.fields.loggingBucket.requiredWhen).toEqual({
      field: "enableLogging",
      value: true,
    });
    // Both overlay targets must exist in the catalog — otherwise the
    // overlay is silently dropped and the requirement never enforced.
    expect(catalogDoc.services.sns.fields).toHaveProperty("kmsKeyId");
    expect(catalogDoc.services.cloudfront.fields).toHaveProperty("loggingBucket");
  });

  it("caches the transformed schema by etag", async () => {
    const first = await getServiceSchema();
    expect(catalogService.getCatalog).toHaveBeenCalledTimes(1);

    // getCatalog is still consulted on every call (catalogService's own TTL
    // cache makes that cheap), but the transform is not repeated: the same
    // etag returns the same cached schema object.
    const second = await getServiceSchema();
    expect(catalogService.getCatalog).toHaveBeenCalledTimes(2);
    expect(second).toBe(first);
  });

  it("re-transforms when the etag changes", async () => {
    await getServiceSchema();
    expect(catalogService.getCatalog).toHaveBeenCalledTimes(1);

    const modified = JSON.parse(JSON.stringify(catalogDoc));
    modified.services.eks.fields.someNewKnob = {
      name: "someNewKnob",
      type: "toggle",
      valueType: "boolean",
    };
    catalogService.getCatalog.mockResolvedValue({ doc: modified, etag: '"fixture-2"' });

    const schema = await getServiceSchema();
    expect(catalogService.getCatalog).toHaveBeenCalledTimes(2);
    expect(schema.eks.fields).toHaveProperty("someNewKnob");
    expect(schema.eks.fields.someNewKnob.type).toBe("toggle");
  });
});

describe("validateServices — valid inputs", () => {
  it("treats null services as valid", async () => {
    expect(await validateServices(null, AWS)).toEqual({ valid: true, errors: [] });
  });

  it("treats undefined services as valid", async () => {
    expect(await validateServices(undefined, AWS)).toEqual({ valid: true, errors: [] });
  });

  it("treats an empty object as valid", async () => {
    expect(await validateServices({}, AWS)).toEqual({ valid: true, errors: [] });
  });

  it("accepts AWS services with correctly-typed field values", async () => {
    const result = await validateServices(validAwsServices(), AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts the eks fields the interim static schema wrongly rejected", async () => {
    // The exact regression from the PR #31 review: networkPolicyEnabled (the
    // real field name), defaultNodeGroupUseLatestAmi and the nine addon
    // knobs are catalog-served and must pass validation.
    const services = {
      eks: {
        enabled: true,
        kubernetesVersion: "1.34",
        networkPolicyEnabled: true,
        defaultNodeGroupUseLatestAmi: true,
        addonCorednsMostRecent: true,
        addonPodIdentityMostRecent: true,
        addonPodIdentityBeforeCompute: true,
        addonKubeProxyMostRecent: true,
        addonVpcCniMostRecent: true,
        addonVpcCniBeforeCompute: true,
        addonEbsCsiMostRecent: true,
        addonEfsCsiMostRecent: true,
      },
    };
    const result = await validateServices(services, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts the lambda service the catalog serves", async () => {
    const result = await validateServices(
      { lambda: { enabled: true, functionNames: ["processor"] } },
      AWS,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts the 'validation does not duplicate the catalog' payload", async () => {
    // Mirrors tests/environment.test.js — the API must accept any value the
    // wizard can offer; option whitelists are the catalog's business.
    const services = {
      rds: { enabled: true, engine: "aurora-postgresql", version: "15.4" },
      eks: { enabled: true, kubernetesVersion: "1.34" },
    };
    const result = await validateServices(services, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("skips type checking for null field values", async () => {
    const result = await validateServices({ vpc: { enabled: null, cidr: null } }, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("skips per-service validation for non-AWS providers", async () => {
    // The catalog currently only covers AWS; non-AWS providers only get
    // the top-level plain-object check.
    const result = await validateServices({ vpc: true, foobar: 1 }, { provider: "gcp" });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts dropdown fields with numeric values", async () => {
    // Dropdown option values may be strings or numbers (e.g. azCount=2).
    const result = await validateServices({ vpc: { enabled: true, azCount: 2 } }, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts number fields within their min/max bounds", async () => {
    const services = {
      eks: { enabled: true, defaultNodeGroupMinSize: 0, defaultNodeGroupMaxSize: 100 },
      msk: { enabled: true, numberOfBrokerNodes: 2 },
      rds: { enabled: true, allocatedStorage: 20 },
    };
    const result = await validateServices(services, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("validateServices — invalid inputs", () => {
  it("rejects an array payload", async () => {
    const result = await validateServices([], AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Services must be a plain object");
  });

  it("rejects a string payload", async () => {
    const result = await validateServices("hello", AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Services must be a plain object");
  });

  it("rejects an unknown service key", async () => {
    const result = await validateServices({ foobar: { enabled: true } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown service "foobar"');
  });

  it("rejects a service value that is not a plain object", async () => {
    const result = await validateServices({ vpc: true }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Service "vpc" must be a plain object');
  });

  it("rejects an unknown field key", async () => {
    const result = await validateServices({ eks: { version: "1.34" } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown field "version" in service "eks"');
  });

  it("rejects a toggle field with a string value", async () => {
    const result = await validateServices({ vpc: { enabled: "yes" } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "vpc.enabled" must be of type toggle, got string');
  });

  it("rejects a number field with a string value", async () => {
    const result = await validateServices({ rds: { allocatedStorage: "100" } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Field "rds.allocatedStorage" must be of type number, got string',
    );
  });

  it("rejects an array field with a string value", async () => {
    const result = await validateServices({ sns: { topicNames: "orders" } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "sns.topicNames" must be of type array, got string');
  });

  it("rejects an object field with a non-object value", async () => {
    const result = await validateServices({ vpc: { publicSubnetTags: "tags" } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Field "vpc.publicSubnetTags" must be of type object, got string',
    );
  });

  it("rejects a number below its minimum", async () => {
    const result = await validateServices({ eks: { defaultNodeGroupMaxSize: 0 } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "eks.defaultNodeGroupMaxSize" must be >= 1, got 0');
  });

  it("rejects a number above its maximum", async () => {
    const result = await validateServices({ eks: { defaultNodeGroupMaxSize: 101 } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "eks.defaultNodeGroupMaxSize" must be <= 100, got 101');
  });

  it("collects multiple errors in one pass", async () => {
    const result = await validateServices(
      { rds: { allocatedStorage: 5, version: 123 }, foobar: {} },
      AWS,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "rds.allocatedStorage" must be >= 20, got 5');
    expect(result.errors).toContain('Field "rds.version" must be of type text, got number');
    expect(result.errors).toContain('Unknown service "foobar"');
  });
});

describe("fail-open when the catalog is unavailable", () => {
  it("validateServices skips per-service checks when getCatalog rejects", async () => {
    catalogService.getCatalog.mockRejectedValue({
      code: "catalog_unavailable",
      message: "Injecto unreachable",
    });
    const result = await validateServices({ foobar: { enabled: true } }, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validateServices skips per-service checks for a degenerate catalog", async () => {
    catalogService.getCatalog.mockResolvedValue({ doc: { services: {} }, etag: '"empty"' });
    const result = await validateServices({ foobar: { enabled: true } }, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validateServicesForGeneration skips checks when getCatalog rejects", async () => {
    catalogService.getCatalog.mockRejectedValue({
      code: "catalog_unavailable",
      message: "Injecto unreachable",
    });
    const result = await validateServicesForGeneration(
      { sns: { enabled: true, enableEncryption: true } },
      AWS,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("validateServicesForGeneration skips checks for a degenerate catalog", async () => {
    catalogService.getCatalog.mockResolvedValue({ doc: { services: {} }, etag: '"empty"' });
    const result = await validateServicesForGeneration(
      { sns: { enabled: true, enableEncryption: true } },
      AWS,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("validateServicesForGeneration — valid inputs", () => {
  it("skips disabled services with missing conditional fields", async () => {
    const result = await validateServicesForGeneration(
      { sns: { enabled: false, enableEncryption: true } },
      AWS,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts an enabled service without conditional dependencies", async () => {
    const result = await validateServicesForGeneration(
      { vpc: { enabled: true, cidr: "10.0.0.0/16" } },
      AWS,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("does not require kmsKeyId when sns encryption is off", async () => {
    const result = await validateServicesForGeneration(
      { sns: { enabled: true, enableEncryption: false } },
      AWS,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("does not require loggingBucket when cloudfront logging is off", async () => {
    const result = await validateServicesForGeneration(
      { cloudfront: { enabled: true, enableLogging: false } },
      AWS,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts conditional fields when their dependencies are met", async () => {
    const services = validAwsServices();
    services.sns = { enabled: true, enableEncryption: true, kmsKeyId: "alias/foo" };
    services.cloudfront = { enabled: true, enableLogging: true, loggingBucket: "logs" };
    const result = await validateServicesForGeneration(services, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("skips generation checks for non-AWS providers", async () => {
    const result = await validateServicesForGeneration(
      { sns: { enabled: true, enableEncryption: true } },
      { provider: "gcp" },
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("validateServicesForGeneration — invalid inputs", () => {
  it("requires kmsKeyId when sns encryption is on", async () => {
    const result = await validateServicesForGeneration(
      { sns: { enabled: true, enableEncryption: true } },
      AWS,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Field "sns.kmsKeyId" is required when sns.enableEncryption is true',
    );
  });

  it("requires loggingBucket when cloudfront logging is on", async () => {
    const result = await validateServicesForGeneration(
      { cloudfront: { enabled: true, enableLogging: true } },
      AWS,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Field "cloudfront.loggingBucket" is required when cloudfront.enableLogging is true',
    );
  });

  it("rejects a truthy-but-not-boolean enabled value", async () => {
    // Structural validation rejects a non-boolean enabled value (TOGGLE
    // type) before the generation pass runs. This test pins the observable
    // behaviour: still invalid, with the toggle-type error.
    for (const enabled of ["true", 1]) {
      const result = await validateServicesForGeneration({ sns: { enabled } }, AWS);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('Field "sns.enabled" must be of type toggle')),
      ).toBe(true);
    }
  });

  it("propagates structural errors (unknown service)", async () => {
    const result = await validateServicesForGeneration({ foobar: { enabled: true } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown service "foobar"');
  });

  it("propagates structural errors (wrong type)", async () => {
    const result = await validateServicesForGeneration({ vpc: { enabled: true, cidr: 123 } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "vpc.cidr" must be of type text, got number');
  });
});

describe("catalog parity — the schema cannot drift from the catalog", () => {
  it("carries every catalog service and field with matching type and bounds", async () => {
    const schema = await getServiceSchema();
    for (const [serviceKey, service] of Object.entries(catalogDoc.services)) {
      expect(schema).toHaveProperty(serviceKey);
      for (const [fieldName, catalogField] of Object.entries(service.fields)) {
        const descriptor = schema[serviceKey].fields[fieldName];
        expect(descriptor).toBeDefined();
        expect(descriptor.type).toBe(catalogField.type);
        if (catalogField.min !== undefined) {
          expect(descriptor.min).toBe(Number(catalogField.min));
        } else {
          expect(descriptor).not.toHaveProperty("min");
        }
        if (catalogField.max !== undefined) {
          expect(descriptor.max).toBe(Number(catalogField.max));
        } else {
          expect(descriptor).not.toHaveProperty("max");
        }
      }
    }
  });
});
