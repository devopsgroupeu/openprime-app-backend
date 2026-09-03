// tests/cloudCredentialController.test.js
// The /test endpoint compares the STS account id against the stored identifier
// so a hand-typed identifier typo is surfaced instead of silently producing
// misnamed Terraform buckets downstream (environmentController builds
// `${identifier}-terraform-${env}` from the identifier).
jest.mock("../src/services/cloudCredentialService", () => ({
  getCredentialById: jest.fn(),
  updateLastValidated: jest.fn(),
}));
jest.mock("../src/services/credentialValidationService", () => ({
  validateAwsCredentials: jest.fn(),
}));

const request = require("supertest");
const app = require("../src/server");
const cloudCredentialService = require("../src/services/cloudCredentialService");
const { validateAwsCredentials } = require("../src/services/credentialValidationService");

const CREDENTIAL_ID = "11111111-1111-1111-1111-111111111111";

describe("POST /api/cloud-credentials/:credentialId/test", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports accountIdMismatch when the STS account differs from the identifier", async () => {
    cloudCredentialService.getCredentialById.mockResolvedValue({
      id: CREDENTIAL_ID,
      provider: "aws",
      identifier: "111111111111",
      credentials: { accessKey: "AKIAEXAMPLE", secretKey: "secret" },
    });
    validateAwsCredentials.mockResolvedValue({
      valid: true,
      accountId: "222222222222",
      arn: "arn:aws:iam::222222222222:user/test",
    });

    const res = await request(app)
      .post(`/api/cloud-credentials/${CREDENTIAL_ID}/test`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.accountId).toBe("222222222222");
    expect(res.body.accountIdMismatch).toBe(true);
    expect(cloudCredentialService.updateLastValidated).toHaveBeenCalledWith(
      CREDENTIAL_ID,
      1,
      expect.any(Date),
    );
  });

  it("reports accountIdMismatch false when the STS account matches the identifier", async () => {
    cloudCredentialService.getCredentialById.mockResolvedValue({
      id: CREDENTIAL_ID,
      provider: "aws",
      identifier: "111111111111",
      credentials: { accessKey: "AKIAEXAMPLE", secretKey: "secret" },
    });
    validateAwsCredentials.mockResolvedValue({
      valid: true,
      accountId: "111111111111",
      arn: "arn:aws:iam::111111111111:user/test",
    });

    const res = await request(app)
      .post(`/api/cloud-credentials/${CREDENTIAL_ID}/test`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.accountIdMismatch).toBe(false);
  });

  it("returns 200 with reason unknown for unrecognized validation results", async () => {
    cloudCredentialService.getCredentialById.mockResolvedValue({
      id: CREDENTIAL_ID,
      provider: "aws",
      identifier: "111111111111",
      credentials: { accessKey: "AKIAEXAMPLE", secretKey: "secret" },
    });
    validateAwsCredentials.mockResolvedValue({
      valid: false,
      reason: "unknown",
      message: "Something unexpected happened",
    });

    const res = await request(app)
      .post(`/api/cloud-credentials/${CREDENTIAL_ID}/test`)
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      valid: false,
      reason: "unknown",
      message: "Something unexpected happened",
    });
    expect(cloudCredentialService.updateLastValidated).not.toHaveBeenCalled();
  });
});
