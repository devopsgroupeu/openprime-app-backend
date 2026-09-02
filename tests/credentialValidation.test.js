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

  it("builds the STS client with explicit credentials in us-east-1", async () => {
    mockSend.mockResolvedValue({ Account: "1", Arn: "arn" });

    await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(STSClient).toHaveBeenCalledWith({
      region: "us-east-1",
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
    });
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

  it("returns network_error for other errors", async () => {
    mockSend.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await validateAwsCredentials("AKIAEXAMPLE", "secret");

    expect(result.valid).toBe(false);
    expect(result.reason).toBe("network_error");
  });

  it("always calls client.destroy()", async () => {
    mockSend.mockResolvedValue({ Account: "1", Arn: "arn" });

    await validateAwsCredentials("AKIAEXAMPLE", "secret");

    const client = STSClient.mock.results[0].value;
    expect(client.destroy).toHaveBeenCalled();
  });

  it("calls client.destroy() even when validation fails", async () => {
    mockSend.mockRejectedValue(new Error("ECONNREFUSED"));

    await validateAwsCredentials("AKIAEXAMPLE", "secret");

    const client = STSClient.mock.results[0].value;
    expect(client.destroy).toHaveBeenCalled();
  });
});
