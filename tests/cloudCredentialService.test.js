// tests/cloudCredentialService.test.js
// Locks in that editing a credential never wipes the stored secret: since the
// API no longer returns decrypted secrets to the client, the edit form sends
// blank secret fields to mean "keep current", and updateCredential must only
// overwrite the secret when a new one is actually provided.
//
// The credential validation service is mocked here so the CRUD logic can be
// tested without real STS calls (the STS client itself is tested separately in
// tests/credentialValidation.test.js).
jest.mock("../src/services/credentialValidationService", () => ({
  validateAwsCredentials: jest.fn(),
}));

const cloudCredentialService = require("../src/services/cloudCredentialService");
const { CloudCredential, Environment } = require("../src/models");
const { validateAwsCredentials } = require("../src/services/credentialValidationService");

// Default the validation mock to "valid" so unrelated CRUD tests are unaffected;
// tests that care override it explicitly.
beforeEach(() => {
  validateAwsCredentials.mockReset();
  validateAwsCredentials.mockResolvedValue({ valid: true, accountId: "1", arn: "arn" });
});

describe("cloudCredentialService.updateCredential — secret preservation", () => {
  let stored;

  beforeEach(() => {
    stored = {
      id: "cred-1",
      provider: "aws",
      credentials: { accessKey: "OLD", secretKey: "OLDSECRET" },
      update: jest.fn().mockImplementation(function update(fields) {
        Object.assign(this, fields);
        return Promise.resolve(this);
      }),
    };
    CloudCredential.findOne = jest.fn().mockResolvedValue(stored);
    CloudCredential.update = jest.fn().mockResolvedValue([1]);
  });

  const fieldsFrom = (cred) => cred.update.mock.calls[0][0];

  it("preserves stored secrets when the update omits credentials", async () => {
    await cloudCredentialService.updateCredential("cred-1", "user-1", { name: "Renamed" });

    const fields = fieldsFrom(stored);
    expect(fields).toHaveProperty("name", "Renamed");
    expect(fields).not.toHaveProperty("credentials");
  });

  it("preserves stored secrets when credentials fields are blank", async () => {
    await cloudCredentialService.updateCredential("cred-1", "user-1", {
      name: "Renamed",
      credentials: { accessKey: "", secretKey: "" },
    });

    expect(fieldsFrom(stored)).not.toHaveProperty("credentials");
  });

  it("overwrites secrets when a new accessKey/secretKey is provided", async () => {
    await cloudCredentialService.updateCredential("cred-1", "user-1", {
      credentials: { accessKey: "NEW", secretKey: "NEWSECRET" },
    });

    expect(fieldsFrom(stored).credentials).toEqual({ accessKey: "NEW", secretKey: "NEWSECRET" });
  });

  it("throws when the credential does not belong to the user", async () => {
    CloudCredential.findOne = jest.fn().mockResolvedValue(null);

    await expect(
      cloudCredentialService.updateCredential("cred-1", "other-user", { name: "x" }),
    ).rejects.toThrow("Credential not found");
  });
});

describe("cloudCredentialService.createCredential — AWS validation", () => {
  beforeEach(() => {
    CloudCredential.create = jest
      .fn()
      .mockImplementation((data) => Promise.resolve({ id: "cred-new", ...data }));
    CloudCredential.update = jest.fn().mockResolvedValue([1]);
  });

  it("calls validation and sets last_validated on success", async () => {
    validateAwsCredentials.mockResolvedValue({
      valid: true,
      accountId: "123456789012",
      arn: "arn:aws:iam::123456789012:user/test",
    });

    const credential = await cloudCredentialService.createCredential("user-1", {
      provider: "aws",
      name: "prod",
      identifier: "123456789012",
      credentials: { accessKey: "AKIAEXAMPLE", secretKey: "secret" },
    });

    expect(validateAwsCredentials).toHaveBeenCalledWith("AKIAEXAMPLE", "secret");
    expect(CloudCredential.create).toHaveBeenCalledWith(
      expect.objectContaining({ last_validated: expect.any(Date) }),
    );
    expect(credential.last_validated).toBeInstanceOf(Date);
  });

  it("throws 400 INVALID_CREDENTIALS on invalid credentials", async () => {
    validateAwsCredentials.mockResolvedValue({
      valid: false,
      reason: "invalid_credentials",
      message: "InvalidClientTokenId: The security token included in the request is invalid.",
    });

    await expect(
      cloudCredentialService.createCredential("user-1", {
        provider: "aws",
        name: "prod",
        identifier: "123456789012",
        credentials: { accessKey: "AKIAEXAMPLE", secretKey: "bad" },
      }),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_CREDENTIALS" });
  });

  it("proceeds on temporary failure without setting last_validated", async () => {
    validateAwsCredentials.mockResolvedValue({
      valid: false,
      reason: "temporary_failure",
      message: "ThrottlingException: Rate exceeded",
    });

    const credential = await cloudCredentialService.createCredential("user-1", {
      provider: "aws",
      name: "prod",
      identifier: "123456789012",
      credentials: { accessKey: "AKIAEXAMPLE", secretKey: "secret" },
    });

    expect(credential.id).toBe("cred-new");
    expect(CloudCredential.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ last_validated: expect.any(Date) }),
    );
  });

  it("proceeds on network failure without setting last_validated", async () => {
    validateAwsCredentials.mockResolvedValue({
      valid: false,
      reason: "network_error",
      message: "ECONNREFUSED",
    });

    const credential = await cloudCredentialService.createCredential("user-1", {
      provider: "aws",
      name: "prod",
      identifier: "123456789012",
      credentials: { accessKey: "AKIAEXAMPLE", secretKey: "secret" },
    });

    expect(credential.id).toBe("cred-new");
    expect(CloudCredential.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ last_validated: expect.any(Date) }),
    );
  });

  it("skips validation for non-AWS providers", async () => {
    const credential = await cloudCredentialService.createCredential("user-1", {
      provider: "azure",
      name: "prod",
      identifier: "sub-123",
      credentials: { tenantId: "t", clientId: "c", clientSecret: "s" },
    });

    expect(validateAwsCredentials).not.toHaveBeenCalled();
    expect(credential.id).toBe("cred-new");
  });
});

describe("cloudCredentialService — partial pairs, unknown results, key-name normalization", () => {
  beforeEach(() => {
    CloudCredential.create = jest
      .fn()
      .mockImplementation((data) => Promise.resolve({ id: "cred-new", ...data }));
    CloudCredential.update = jest.fn().mockResolvedValue([1]);
  });

  it("throws 400 when create provides only an access key", async () => {
    await expect(
      cloudCredentialService.createCredential("user-1", {
        provider: "aws",
        name: "prod",
        identifier: "123456789012",
        credentials: { accessKey: "AKIAEXAMPLE" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CREDENTIALS",
      message: "Both access key and secret key are required",
    });
    expect(CloudCredential.create).not.toHaveBeenCalled();
  });

  it("throws 400 when create provides only a secret key", async () => {
    await expect(
      cloudCredentialService.createCredential("user-1", {
        provider: "aws",
        name: "prod",
        identifier: "123456789012",
        credentials: { secretKey: "secret" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CREDENTIALS",
      message: "Both access key and secret key are required",
    });
    expect(CloudCredential.create).not.toHaveBeenCalled();
  });

  it("throws 400 when update provides only one key", async () => {
    const stored = {
      id: "cred-1",
      provider: "aws",
      credentials: { accessKey: "OLD", secretKey: "OLDSECRET" },
      update: jest.fn().mockResolvedValue({}),
    };
    CloudCredential.findOne = jest.fn().mockResolvedValue(stored);

    await expect(
      cloudCredentialService.updateCredential("cred-1", "user-1", {
        credentials: { accessKey: "NEW" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CREDENTIALS",
      message:
        "Both access key and secret key are required to update credentials (leave both blank to keep the current ones)",
    });
    expect(stored.update).not.toHaveBeenCalled();
  });

  it("throws 400 CREDENTIAL_VERIFICATION_FAILED on unknown create result and does not store", async () => {
    validateAwsCredentials.mockResolvedValue({
      valid: false,
      reason: "unknown",
      message: "Something unexpected happened",
    });

    await expect(
      cloudCredentialService.createCredential("user-1", {
        provider: "aws",
        name: "prod",
        identifier: "123456789012",
        credentials: { accessKey: "AKIAEXAMPLE", secretKey: "secret" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "CREDENTIAL_VERIFICATION_FAILED",
      message: "Could not verify AWS credentials: Something unexpected happened",
    });
    expect(CloudCredential.create).not.toHaveBeenCalled();
  });

  it("throws 400 CREDENTIAL_VERIFICATION_FAILED on unknown update result", async () => {
    const stored = {
      id: "cred-1",
      provider: "aws",
      credentials: { accessKey: "OLD", secretKey: "OLDSECRET" },
      update: jest.fn().mockResolvedValue({}),
    };
    CloudCredential.findOne = jest.fn().mockResolvedValue(stored);
    validateAwsCredentials.mockResolvedValue({
      valid: false,
      reason: "unknown",
      message: "Something unexpected happened",
    });

    await expect(
      cloudCredentialService.updateCredential("cred-1", "user-1", {
        credentials: { accessKey: "NEW", secretKey: "NEWSECRET" },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "CREDENTIAL_VERIFICATION_FAILED",
      message: "Could not verify AWS credentials: Something unexpected happened",
    });
    expect(stored.update).not.toHaveBeenCalled();
  });

  it("validates credentials stored with accessKeyId/secretAccessKey names on create", async () => {
    validateAwsCredentials.mockResolvedValue({ valid: true, accountId: "1", arn: "arn" });

    await cloudCredentialService.createCredential("user-1", {
      provider: "aws",
      name: "prod",
      identifier: "123456789012",
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
    });

    expect(validateAwsCredentials).toHaveBeenCalledWith("AKIAEXAMPLE", "secret");
  });

  it("validates and stores credentials provided with accessKeyId/secretAccessKey names on update", async () => {
    const stored = {
      id: "cred-1",
      provider: "aws",
      credentials: { accessKey: "OLD", secretKey: "OLDSECRET" },
      update: jest.fn().mockImplementation(function update(fields) {
        Object.assign(this, fields);
        return Promise.resolve(this);
      }),
    };
    CloudCredential.findOne = jest.fn().mockResolvedValue(stored);
    validateAwsCredentials.mockResolvedValue({ valid: true, accountId: "1", arn: "arn" });

    await cloudCredentialService.updateCredential("cred-1", "user-1", {
      credentials: { accessKeyId: "NEW", secretAccessKey: "NEWSECRET" },
    });

    expect(validateAwsCredentials).toHaveBeenCalledWith("NEW", "NEWSECRET");
    expect(stored.update.mock.calls[0][0].credentials).toEqual({
      accessKeyId: "NEW",
      secretAccessKey: "NEWSECRET",
    });
  });
});

describe("cloudCredentialService.getCredentialUsage", () => {
  beforeEach(() => {
    Environment.count = jest.fn().mockResolvedValue(2);
    Environment.findAll = jest.fn().mockResolvedValue([
      { id: "env-1", name: "prod" },
      { id: "env-2", name: "staging" },
    ]);
  });

  it("returns the count and environment list", async () => {
    const usage = await cloudCredentialService.getCredentialUsage("cred-1", "user-1");

    expect(usage).toEqual({
      count: 2,
      environments: [
        { id: "env-1", name: "prod" },
        { id: "env-2", name: "staging" },
      ],
    });
  });

  it("scopes the query by credential id and user id", async () => {
    await cloudCredentialService.getCredentialUsage("cred-1", "user-1");

    expect(Environment.count).toHaveBeenCalledWith({
      where: { cloud_credential_id: "cred-1", user_id: "user-1" },
    });
    expect(Environment.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cloud_credential_id: "cred-1", user_id: "user-1" },
        limit: 50,
      }),
    );
  });

  it("returns zero usage when no environments reference the credential", async () => {
    Environment.count = jest.fn().mockResolvedValue(0);
    Environment.findAll = jest.fn().mockResolvedValue([]);

    const usage = await cloudCredentialService.getCredentialUsage("cred-1", "user-1");

    expect(usage).toEqual({ count: 0, environments: [] });
  });
});
