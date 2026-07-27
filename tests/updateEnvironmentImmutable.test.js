// setup.js mocks the whole environmentService; test the real update path here.
// Regression for OP-213: name and global_prefix name every generated Terraform
// resource, so changing them on an existing environment would turn the next
// apply into a full destroy/recreate.
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const { Environment } = require("../src/models");
const environmentService = jest.requireActual("../src/services/environmentService");

const stored = {
  id: "env-1",
  name: "prod",
  global_prefix: "op-",
  provider: "aws",
  region: "eu-west-1",
  services: { vpc: { enabled: true } },
  terraform_backend: { enabled: true },
  git_repository: null,
  cloud_credential_id: "cred-1",
};

const makeEnvironment = () => {
  const record = {
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
  return record;
};

describe("updateEnvironmentByUser — immutable name and global prefix", () => {
  let record;

  beforeEach(() => {
    record = makeEnvironment();
    Environment.findOne = jest.fn().mockResolvedValue(record);
  });

  test("accepts an update that posts the unchanged name and prefix back", async () => {
    const result = await environmentService.updateEnvironmentByUser("env-1", "user-1", {
      name: "prod",
      globalPrefix: "op-",
      provider: "aws",
      region: "eu-west-1",
      services: { vpc: { enabled: true }, eks: { enabled: true } },
    });

    expect(record.update).toHaveBeenCalledTimes(1);
    expect(result.services.eks).toEqual({ enabled: true });
    expect(result.global_prefix).toBe("op-");
  });

  test("accepts an update that omits them entirely", async () => {
    await environmentService.updateEnvironmentByUser("env-1", "user-1", {
      provider: "aws",
      region: "eu-west-1",
      services: {},
    });

    const [updateData] = record.update.mock.calls[0];
    expect(updateData.name).toBe("prod");
    expect(updateData.global_prefix).toBe("op-");
  });

  test("rejects a changed global prefix with 400 instead of silently applying it", async () => {
    await expect(
      environmentService.updateEnvironmentByUser("env-1", "user-1", {
        name: "prod",
        globalPrefix: "renamed-",
        services: {},
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("globalPrefix cannot be changed"),
    });

    expect(record.update).not.toHaveBeenCalled();
  });

  test("rejects a changed name with 400", async () => {
    await expect(
      environmentService.updateEnvironmentByUser("env-1", "user-1", {
        name: "staging",
        services: {},
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(record.update).not.toHaveBeenCalled();
  });
});
