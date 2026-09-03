// tests/credentialValidation.test.js
// The STS client is the thing under test here, so @aws-sdk/client-sts is mocked
// at module level and the real credentialValidationService is exercised against
// it (setup.js does not mock this service).
const mockSend = jest.fn();

jest.mock("@aws-sdk/client-sts", () => ({
  STSClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
    destroy: jest.fn(),
  })),
  GetCallerIdentityCommand: jest.fn().mockImplementation((params) => params),
}));

const { STSClient } = require("@aws-sdk/client-sts");
const { validateAwsCredentials } = require("../src/services/credentialValidationService");

const STS_CONFIG = {
  region: "us-east-1",
  credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
  requestHandler: { requestTimeout: 5000, connectionTimeout: 2000 },
  maxAttempts: 2,
};

describe("credentialValidationService.validateAwsCredentials", () => {
  beforeEach(() => {
    mockSend.mockReset();
    STSClient.mockClear();
  });

  it("returns valid with accountId and arn on success", async () => {
    mockSend.mockResolvedValue({
      Account: "123456789012",
      Arn: "arn:aws:iam::123456789012:user/test-user",
    });

    const result = await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(result).toEqual({
      valid: true,
      accountId: "123456789012",
      arn: "arn:aws:iam::123456789012:user/test-user",
    });
  });

  it("builds the STS client with explicit credentials, timeouts and retries", async () => {
    mockSend.mockResolvedValue({ Account: "1", Arn: "arn" });

    await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(STSClient).toHaveBeenCalledWith(STS_CONFIG);
  });

  it("returns invalid_credentials for InvalidClientTokenId", async () => {
    const error = new Error(
      "InvalidClientTokenId: The security token included in the request is invalid.",
    );
    error.name = "InvalidClientTokenId";
    mockSend.mockRejectedValue(error);

    const result = await validateAwsCredentials("AKIAEXAMPLE", "bad-secret");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_credentials");
    expect(result.message).toMatch(/InvalidClientTokenId/);
  });

  it("returns temporary_failure for ThrottlingException", async () => {
    const error = new Error("ThrottlingException: Rate exceeded");
    error.name = "ThrottlingException";
    mockSend.mockRejectedValue(error);

    const result = await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("temporary_failure");
  });

  it("returns temporary_failure for AWS 5xx responses", async () => {
    const error = new Error("Service Unavailable");
    error.name = "UnrecognizedServiceException";
    error.$metadata = { httpStatusCode: 503 };
    mockSend.mockRejectedValue(error);

    const result = await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("temporary_failure");
  });

  it("returns network_error for Node system errors", async () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:443");
    error.code = "ECONNREFUSED";
    mockSend.mockRejectedValue(error);

    const result = await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("network_error");
  });

  it("returns network_error when the message mentions fetch failed", async () => {
    mockSend.mockRejectedValue(new Error("fetch failed"));

    const result = await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("network_error");
  });

  it("returns unknown for unrecognized errors", async () => {
    mockSend.mockRejectedValue(new Error("Something completely unexpected"));

    const result = await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("unknown");
  });

  it.each([
    ["missing access key", undefined, "secret"],
    ["missing secret key", "AKIAEXAMPLE", undefined],
    ["empty access key", "", "secret"],
    ["empty secret key", "AKIAEXAMPLE", ""],
    ["whitespace-only access key", "   ", "secret"],
    ["whitespace-only secret key", "AKIAEXAMPLE", "   "],
  ])(
    "rejects %s without constructing an STS client",
    async (_label, accessKeyId, secretAccessKey) => {
      const result = await validateAwsCredentials(accessKeyId, secretAccessKey);

      expect(result).toEqual({
        valid: false,
        reason: "invalid_credentials",
        message: "Both access key ID and secret access key are required",
      });
      expect(STSClient).not.toHaveBeenCalled();
    },
  );

  it("always calls client.destroy()", async () => {
    mockSend.mockResolvedValue({ Account: "1", Arn: "arn" });

    await validateAwsCredentials("AKIAEXAMPLE", "secret");

    const client = STSClient.mock.results[0].value;
    expect(client.destroy).toHaveBeenCalled();
  });

  it("calls client.destroy() even when validation fails", async () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:443");
    error.code = "ECONNREFUSED";
    mockSend.mockRejectedValue(error);

    await validateAwsCredentials("AKIAEXAMPLE", "secret");

    const client = STSClient.mock.results[0].value;
    expect(client.destroy).toHaveBeenCalled();
  });
});
