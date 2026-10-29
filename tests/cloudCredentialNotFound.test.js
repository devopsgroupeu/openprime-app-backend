// tests/cloudCredentialNotFound.test.js
// A credential id that does not exist, or belongs to someone else, is the
// caller's mistake: 404, not a 500 that reads like a server fault.
const request = require("supertest");
const app = require("../src/server");
const { CloudCredential } = require("../src/models");

const MISSING_ID = "11111111-1111-1111-1111-111111111111";

describe("cloud credential not found", () => {
  beforeEach(() => {
    CloudCredential.findOne = jest.fn().mockResolvedValue(null);
  });

  it.each([
    ["PUT", `/api/cloud-credentials/${MISSING_ID}`, { name: "renamed" }],
    ["DELETE", `/api/cloud-credentials/${MISSING_ID}`, undefined],
    ["PUT", `/api/cloud-credentials/${MISSING_ID}/default`, undefined],
  ])("%s %s answers 404", async (method, path, body) => {
    const req = request(app)[method.toLowerCase()](path).set("Authorization", "Bearer test-token");
    const res = await (body ? req.send(body) : req);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Credential not found", requestId: "test-request-id" });
  });
});
