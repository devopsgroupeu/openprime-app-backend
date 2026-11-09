// tests/requestValidation.test.js
// OP-271 (D85): the cloud-credential and profile routes declare
// express-validator rules, but nothing ever read their result, so every
// declared rule was decoration. Invalid input must answer 400 with the same
// `{ errors: [...] }` body the environment routes use, before any controller
// or database work. Each case has a valid twin that must get past validation.
const request = require("supertest");
const app = require("../src/server");
const { CloudCredential } = require("../src/models");
const userService = require("../src/services/userService");

const AUTH = { Authorization: "Bearer test-token" };
const MISSING_ID = "11111111-1111-4111-8111-111111111111";

const send = (method, path, body) => {
  const req = request(app)[method](path).set(AUTH);
  return body === undefined ? req : req.send(body);
};

describe("cloud credential routes reject invalid input", () => {
  beforeEach(() => {
    CloudCredential.findOne = jest.fn().mockResolvedValue(null);
    jest.spyOn(userService, "getUserByKeycloakId").mockResolvedValue({ id: "user-1" });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [
      "post",
      "/api/cloud-credentials",
      { provider: "nope", name: "n", identifier: "i", credentials: {} },
    ],
    [
      "post",
      "/api/cloud-credentials",
      { provider: "aws", name: "", identifier: "i", credentials: {} },
    ],
    [
      "post",
      "/api/cloud-credentials",
      { provider: "aws", name: "n", identifier: "i", credentials: "x" },
    ],
    [
      "post",
      "/api/cloud-credentials",
      { provider: "aws", name: "n", identifier: "i", credentials: {}, isDefault: "yes" },
    ],
    ["get", "/api/cloud-credentials/not-a-uuid", undefined],
    ["put", "/api/cloud-credentials/not-a-uuid", { name: "renamed" }],
    ["put", `/api/cloud-credentials/${MISSING_ID}`, { name: "" }],
    ["put", `/api/cloud-credentials/${MISSING_ID}`, { credentials: "x" }],
    ["delete", "/api/cloud-credentials/not-a-uuid", undefined],
    ["put", "/api/cloud-credentials/not-a-uuid/default", undefined],
  ])("%s %s %j answers 400", async (method, path, body) => {
    const res = await send(method, path, body);

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(CloudCredential.findOne).not.toHaveBeenCalled();
  });

  it.each([
    ["put", `/api/cloud-credentials/${MISSING_ID}`, { name: "renamed" }],
    ["delete", `/api/cloud-credentials/${MISSING_ID}`, undefined],
    ["put", `/api/cloud-credentials/${MISSING_ID}/default`, undefined],
  ])("valid %s %s gets past validation (404 from the service)", async (method, path, body) => {
    const res = await send(method, path, body);

    expect(res.status).toBe(404);
  });
});

// The auth middleware also looks the user up (deactivated users, OP-262), so
// "the controller ran" is measured by the write itself: user.update.
describe("profile route rejects invalid input", () => {
  let update;
  beforeEach(() => {
    update = jest.fn().mockResolvedValue({ id: "user-1" });
    jest
      .spyOn(userService, "getUserByKeycloakId")
      .mockResolvedValue({ id: "user-1", is_active: true, update });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [{ firstName: "x".repeat(101) }],
    [{ lastName: "x".repeat(101) }],
    [{ firstName: 42 }],
    [{ email: "not-an-email" }],
  ])("PUT /api/users/me/profile %j answers 400", async (body) => {
    const res = await send("put", "/api/users/me/profile", body);

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.errors)).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  // The exact bodies openprime-app's SettingsPage sends on "Save": all three
  // fields, each "" when the user has none. They must not start failing.
  it.each([
    [{ firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" }],
    [{ firstName: "Ada", lastName: "", email: "ada@example.com" }],
    [{ firstName: "", lastName: "", email: "" }],
  ])("the settings page body %j gets past validation and is stored", async (body) => {
    const res = await send("put", "/api/users/me/profile", body);

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
