// OP-244: generated environments used to publish OUR domain. The domain is now a
// top-level environment field, editable after creation, and an empty one means
// "ship no host-based ingresses" rather than "fall back to a template default".
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const { validationResult } = require("express-validator");
const { Environment } = require("../src/models");
const { validateEnvironment } = require("../src/validators/environmentValidator");
const environmentService = jest.requireActual("../src/services/environmentService");

describe("prepareInjectoData — domain (OP-244)", () => {
  const base = {
    name: "prod",
    provider: "aws",
    region: "eu-west-1",
    terraform_backend: null,
    state_key: "env/abc-123",
  };

  test("carries the configured domain to Injecto", () => {
    const data = environmentService.prepareInjectoData({ ...base, domain: "example.com" });
    expect(data.domain).toBe("example.com");
  });

  test("an unset domain is sent as an empty string, not omitted", () => {
    const data = environmentService.prepareInjectoData({ ...base, domain: null });
    // The distinction that matters: a missing key leaves `@param domain`
    // unresolved, and an unresolved @param ships the template's own default.
    expect(data).toHaveProperty("domain");
    expect(data.domain).toBe("");
  });
});

describe("updateEnvironmentByUser — domain is editable (OP-244)", () => {
  const stored = {
    id: "env-1",
    name: "prod",
    global_prefix: "op-",
    provider: "aws",
    region: "eu-west-1",
    domain: "old.example.com",
    services: {},
    terraform_backend: null,
    git_repository: null,
    cloud_credential_id: null,
  };

  let record;

  beforeEach(() => {
    record = {
      ...stored,
      update: jest.fn(function (data) {
        Object.assign(this, data);
        return Promise.resolve(this);
      }),
      toJSON() {
        const { update, toJSON, ...rest } = this;
        return rest;
      },
    };
    Environment.findOne = jest.fn().mockResolvedValue(record);
  });

  const update = (data) => environmentService.updateEnvironmentByUser("env-1", "user-1", data);

  test("a new domain replaces the old one — unlike name and global prefix", async () => {
    const result = await update({ provider: "aws", domain: "new.example.com", services: {} });
    expect(result.domain).toBe("new.example.com");
  });

  test("omitting the field keeps the stored domain", async () => {
    await update({ provider: "aws", services: {} });
    expect(record.update.mock.calls[0][0].domain).toBe("old.example.com");
  });

  test("an empty string clears it, which is how a customer removes the ingresses", async () => {
    await update({ provider: "aws", domain: "", services: {} });
    expect(record.update.mock.calls[0][0].domain).toBeNull();
  });
});

describe("validateEnvironment — domain (OP-244)", () => {
  const run = async (body) => {
    const req = { body };
    for (const validator of validateEnvironment) {
      await validator.run(req);
    }
    return validationResult(req)
      .array()
      .filter((e) => e.path === "domain");
  };

  const valid = { name: "prod", provider: "aws" };

  test.each(["example.com", "sub.example.com", "a-b.co.uk", "xn--80ak6aa92e.com"])(
    "accepts %s",
    async (domain) => {
      expect(await run({ ...valid, domain })).toEqual([]);
    },
  );

  test.each([
    ["an empty domain, which means no host-based ingresses", ""],
    ["a null domain", null],
  ])("accepts %s", async (_label, domain) => {
    expect(await run({ ...valid, domain })).toEqual([]);
  });

  test.each([
    ["a bare label with no TLD", "localhost"],
    ["a URL rather than a hostname", "https://example.com"],
    ["a host with a path", "example.com/argocd"],
    ["a leading dot", ".example.com"],
    ["a hyphen-led label", "-bad.example.com"],
    ["an HCL-unsafe quote", 'example.com"'],
    ["a newline", "example.com\nfoo"],
    ["a space", "example .com"],
    ["a numeric TLD", "example.123"],
  ])("rejects %s", async (_label, domain) => {
    expect(await run({ ...valid, domain })).toHaveLength(1);
  });
});
