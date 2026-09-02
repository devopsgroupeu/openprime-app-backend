// tests/serviceSchema.test.js
//
// Tests for the shared server-side service schema validation
// (src/validators/serviceSchema.js). Covers structural validation for
// create/update (validateServices) and structural + conditional required-field
// validation for generation (validateServicesForGeneration).
const {
  getServiceSchema,
  validateServices,
  validateServicesForGeneration,
} = require("../src/validators/serviceSchema");

const AWS = { provider: "aws" };

// A representative set of AWS services with correctly-typed values.
function validAwsServices() {
  return {
    vpc: { enabled: true, cidr: "10.0.0.0/16" },
    eks: {
      enabled: true,
      kubernetesVersion: "1.31",
      defaultNodeGroupMinSize: 2,
      defaultNodeGroupMaxSize: 4,
    },
    rds: {
      enabled: true,
      engine: "postgres",
      allocatedStorage: 100,
      backupRetention: 7,
    },
  };
}

describe("getServiceSchema", () => {
  it("returns an object with the 14 user-facing AWS service keys", async () => {
    const schema = await getServiceSchema();
    const expected = [
      "vpc",
      "eks",
      "rds",
      "aurora",
      "opensearch",
      "ecr",
      "s3",
      "elasticache",
      "msk",
      "waf",
      "sqs",
      "sns",
      "cloudfront",
      "route53",
    ].sort();
    expect(Object.keys(schema).sort()).toEqual(expected);
  });

  it("gives every service a fields object", async () => {
    const schema = await getServiceSchema();
    for (const [serviceName, service] of Object.entries(schema)) {
      expect(service).toHaveProperty("fields");
      expect(typeof service.fields).toBe("object");
      expect(service.fields).not.toBeNull();
      expect(Array.isArray(service.fields)).toBe(false);
      expect(Object.keys(service.fields).length).toBeGreaterThan(0);
    }
  });

  it("does not include lambda (available: false in the wizard)", async () => {
    const schema = await getServiceSchema();
    expect(schema).not.toHaveProperty("lambda");
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

  it("skips type checking for null field values", async () => {
    const result = await validateServices({ vpc: { enabled: null, cidr: null } }, AWS);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("skips per-service validation for non-AWS providers", async () => {
    // The static schema only covers AWS; non-AWS providers only get the
    // top-level plain-object check.
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
      aurora: { enabled: true, serverlessv2MaxCapacity: 0.5 },
      msk: { enabled: true, numberOfBrokerNodes: 2 },
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
    for (const services of [{ lambda: { enabled: true } }, { foobar: { enabled: true } }]) {
      const result = await validateServices(services, AWS);
      expect(result.valid).toBe(false);
      const unknown = Object.keys(services)[0];
      expect(result.errors).toContain(`Unknown service "${unknown}"`);
    }
  });

  it("rejects a service value that is not a plain object", async () => {
    const result = await validateServices({ vpc: true }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Service "vpc" must be a plain object');
  });

  it("rejects an unknown field key", async () => {
    const result = await validateServices({ vpc: { foobar: 1 } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown field "foobar" in service "vpc"');
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
    const result = await validateServices({ ecr: { repositoryNames: "repo" } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'Field "ecr.repositoryNames" must be of type array, got string',
    );
  });

  it("rejects an object field with a non-object value", async () => {
    const result = await validateServices({ aurora: { instances: "single" } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "aurora.instances" must be of type object, got string');
  });

  it("rejects a number below its minimum", async () => {
    const result = await validateServices({ rds: { allocatedStorage: 5 } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "rds.allocatedStorage" must be >= 20, got 5');
  });

  it("rejects a number above its maximum", async () => {
    const result = await validateServices({ rds: { allocatedStorage: 5000 } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "rds.allocatedStorage" must be <= 1000, got 5000');
  });

  it("collects multiple errors in one pass", async () => {
    const result = await validateServices(
      { rds: { allocatedStorage: 5, engine: 123 }, bogus: {} },
      AWS,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
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

  it("accepts a full valid AWS services payload", async () => {
    const services = validAwsServices();
    services.sns = { enabled: true, enableEncryption: true, kmsKeyId: "alias/foo" };
    services.cloudfront = { enabled: true, enableLogging: true, loggingBucket: "logs" };
    const result = await validateServicesForGeneration(services, AWS);
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
    // Note: the strictly-true check in validateServicesForGeneration is
    // currently unreachable — structural validation rejects a non-boolean
    // enabled value (TOGGLE type) first. The result is still invalid, just
    // with the toggle-type error rather than the "must be strictly true"
    // message. This test pins the observable behaviour.
    for (const enabled of ["true", 1]) {
      const result = await validateServicesForGeneration({ sns: { enabled } }, AWS);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('Field "sns.enabled" must be of type toggle')),
      ).toBe(true);
    }
  });

  it("propagates structural errors (unknown service)", async () => {
    const result = await validateServicesForGeneration({ lambda: { enabled: true } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown service "lambda"');
  });

  it("propagates structural errors (wrong type)", async () => {
    const result = await validateServicesForGeneration({ vpc: { enabled: true, cidr: 123 } }, AWS);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Field "vpc.cidr" must be of type text, got number');
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
