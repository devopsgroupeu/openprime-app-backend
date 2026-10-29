// tests/terraformBackendErrors.test.js
// StateCraft answers a bucket it must not take over (409), an invalid name (400)
// or missing customer permissions (403) with a message written for the user.
// The backend used to collapse all of them into a generic 500 (OP-261).
const request = require("supertest");
const app = require("../src/server");
const statecraftService = require("../src/services/statecraftService");
const cloudCredentialService = require("../src/services/cloudCredentialService");

const TAKEN =
  "Bucket '123456789012-terraform-demo' already exists in this AWS account and StateCraft did not create it for this environment. Use it as an existing backend, or choose a different environment name.";

const create = () =>
  request(app)
    .post("/api/environments/terraform-backend/create")
    .set("Authorization", "Bearer test-token")
    .send({ region: "eu-west-1", environmentName: "demo", cloudCredentialId: "cred-1" });

describe("terraform backend creation errors", () => {
  beforeEach(() => {
    jest.spyOn(cloudCredentialService, "getCredentialById").mockResolvedValue({
      identifier: "123456789012",
      credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" },
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    [409, TAKEN],
    [400, "Invalid bucket name 'x'. It must follow AWS S3 naming rules."],
    [403, "Access denied creating the state bucket."],
  ])("passes StateCraft's %i and its message to the user", async (status, message) => {
    statecraftService.createBackendResources.mockResolvedValueOnce({
      success: false,
      status,
      error: message,
    });

    const res = await create();

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ success: false, error: message });
  });

  it.each([401, 422, 500, undefined])(
    "keeps a generic 500 for StateCraft status %s, which is ours to fix",
    async (status) => {
      statecraftService.createBackendResources.mockResolvedValueOnce({
        success: false,
        status,
        error: "service token rejected",
      });

      const res = await create();

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to create Terraform backend resources");
    },
  );
});

describe("statecraftService.createBackendResources error shape", () => {
  // The real service, with axios taken from the same isolated module registry so
  // the spies below are the instance it calls.
  let service;
  let axios;

  beforeEach(() => {
    jest.isolateModules(() => {
      axios = require("axios");
      service = jest.requireActual("../src/services/statecraftService");
    });
  });

  afterEach(() => jest.restoreAllMocks());

  const fail = (response) =>
    jest.spyOn(axios, "post").mockRejectedValueOnce(Object.assign(new Error("boom"), { response }));
  const config = { region: "eu-west-1", bucketName: "b", lockingMechanism: "s3" };

  it("reads the message out of StateCraft's object detail and keeps the status", async () => {
    fail({ status: 409, data: { detail: { message: TAKEN, details: { s3_bucket: "failed" } } } });
    await expect(service.createBackendResources(config)).resolves.toEqual({
      success: false,
      status: 409,
      error: TAKEN,
    });
  });

  it("accepts a plain string detail", async () => {
    fail({ status: 400, data: { detail: "Invalid region" } });
    await expect(service.createBackendResources(config)).resolves.toEqual({
      success: false,
      status: 400,
      error: "Invalid region",
    });
  });

  it("falls back to the transport error when StateCraft never answered", async () => {
    jest.spyOn(axios, "post").mockRejectedValueOnce(new Error("connect ECONNREFUSED"));
    await expect(service.createBackendResources(config)).resolves.toEqual({
      success: false,
      status: undefined,
      error: "connect ECONNREFUSED",
    });
  });
});
