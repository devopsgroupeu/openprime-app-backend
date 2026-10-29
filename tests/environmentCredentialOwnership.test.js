// tests/environmentCredentialOwnership.test.js
// OP-262 (D24): an environment's cloudCredentialId came straight from the
// request body and was stored without checking whose credential it was, so
// the environment list showed another user's credential name, AWS account id
// and provider. Ownership is checked in the service on create and on update,
// and a foreign id answers 404 like any other object the caller does not own.
//
// Over HTTP through the real route, validator, controller, service and error
// handler, against a store that enforces the where clause.
jest.unmock("../src/services/environmentService");

const request = require("supertest");
const app = require("../src/server");
const { Environment, CloudCredential } = require("../src/models");

// tests/setup.js authenticates every request as the user whose internal id is 1.
const ME = 1;
const SOMEONE_ELSE = "user-other";

const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);

const makeEnvironment = (fields) => ({
  ...fields,
  update: jest.fn(function (data) {
    Object.assign(this, data);
    return Promise.resolve(this);
  }),
  toJSON() {
    const { update: _u, toJSON: _t, ...rest } = this;
    return rest;
  },
});

let environments;

beforeEach(() => {
  const credentials = [
    { id: "cred-mine", user_id: ME, name: "mine", identifier: "111111111111" },
    { id: "cred-theirs", user_id: SOMEONE_ELSE, name: "theirs", identifier: "222222222222" },
  ];
  environments = [
    makeEnvironment({
      id: "env-mine",
      user_id: ME,
      name: "prod",
      global_prefix: "prod-",
      provider: "aws",
      region: "eu-west-1",
      services: {},
      terraform_backend: null,
      git_repository: null,
      cloud_credential_id: "cred-mine",
    }),
  ];

  CloudCredential.findOne = jest.fn(({ where }) =>
    Promise.resolve(credentials.find((c) => matches(c, where)) || null),
  );
  Environment.findOne = jest.fn(({ where }) =>
    Promise.resolve(environments.find((e) => matches(e, where)) || null),
  );
  Environment.create = jest.fn((data) => {
    const environment = makeEnvironment({ id: "env-new", ...data });
    environments.push(environment);
    return Promise.resolve(environment);
  });
});

const newEnvironment = (cloudCredentialId) => ({
  name: "staging",
  globalPrefix: "staging-",
  provider: "aws",
  region: "eu-west-1",
  cloudCredentialId,
});

const edit = (cloudCredentialId) => ({
  name: "prod",
  provider: "aws",
  region: "eu-west-1",
  cloudCredentialId,
});

describe("creating an environment", () => {
  it("answers 404 for another user's credential and stores nothing", async () => {
    const res = await request(app).post("/api/environments").send(newEnvironment("cred-theirs"));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Cloud credential not found");
    expect(Environment.create).not.toHaveBeenCalled();
  });

  it("accepts the caller's own credential", async () => {
    const res = await request(app).post("/api/environments").send(newEnvironment("cred-mine"));

    expect(res.status).toBe(201);
    expect(res.body.cloud_credential_id).toBe("cred-mine");
  });
});

describe("updating an environment", () => {
  it("answers 404 for another user's credential and leaves the row alone", async () => {
    const res = await request(app).put("/api/environments/env-mine").send(edit("cred-theirs"));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Cloud credential not found");
    expect(environments[0].update).not.toHaveBeenCalled();
    expect(environments[0].cloud_credential_id).toBe("cred-mine");
  });

  it("accepts the caller's own credential", async () => {
    const res = await request(app).put("/api/environments/env-mine").send(edit("cred-mine"));

    expect(res.status).toBe(200);
    expect(res.body.cloud_credential_id).toBe("cred-mine");
  });
});
