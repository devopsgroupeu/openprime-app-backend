// setup.js mocks the whole environmentService away, so the ownership scoping
// that keeps one customer out of another customer's environment had never been
// executed by a test. OP-192 asks for cross-user access denial; this exercises
// the real service against a store that enforces the where clause for real,
// rather than asserting on the shape of the query object.
//
// The destructive assertions matter most: update() and destroy() must not be
// reached at all when the requester does not own the row.
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const { Environment } = require("../src/models");
const environmentService = jest.requireActual("../src/services/environmentService");

const OWNER = "user-owner";
const INTRUDER = "user-intruder";
const ENV_ID = "env-1";

let update;
let destroy;

const makeRow = () => ({
  id: ENV_ID,
  user_id: OWNER,
  name: "prod",
  global_prefix: "op-",
  provider: "aws",
  region: "eu-west-1",
  services: {},
  terraform_backend: {},
  git_repository: null,
  cloud_credential_id: null,
  update,
  destroy,
  toJSON() {
    const { update: _u, destroy: _d, toJSON: _t, ...rest } = this;
    return rest;
  },
});

beforeEach(() => {
  update = jest.fn().mockImplementation(function (data) {
    Object.assign(this, data);
    return Promise.resolve(this);
  });
  destroy = jest.fn().mockResolvedValue(undefined);

  const rows = [makeRow()];
  const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);

  Environment.findOne = jest
    .fn()
    .mockImplementation(({ where }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) || null),
    );
  Environment.findAll = jest
    .fn()
    .mockImplementation(({ where }) => Promise.resolve(rows.filter((r) => matches(r, where))));
});

describe("an environment is only reachable by the user who owns it", () => {
  it("returns the environment to its owner", async () => {
    const found = await environmentService.getEnvironmentByIdAndUser(ENV_ID, OWNER);

    expect(found).not.toBeNull();
    expect(found.id).toBe(ENV_ID);
  });

  it("returns null to another user asking for the same id", async () => {
    expect(await environmentService.getEnvironmentByIdAndUser(ENV_ID, INTRUDER)).toBeNull();
  });

  it("never lists another user's environments", async () => {
    expect(await environmentService.getUserEnvironments(OWNER)).toHaveLength(1);
    expect(await environmentService.getUserEnvironments(INTRUDER)).toEqual([]);
  });
});

describe("cross-user writes are refused without touching the row", () => {
  it("refuses an update from a non-owner and does not call update()", async () => {
    const result = await environmentService.updateEnvironmentByUser(ENV_ID, INTRUDER, {
      region: "us-east-1",
    });

    expect(result).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a delete from a non-owner and does not call destroy()", async () => {
    const result = await environmentService.deleteEnvironmentByUser(ENV_ID, INTRUDER);

    expect(result).toBe(false);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("still allows the owner to update and delete", async () => {
    expect(
      await environmentService.updateEnvironmentByUser(ENV_ID, OWNER, { region: "us-east-1" }),
    ).not.toBeNull();
    expect(update).toHaveBeenCalled();

    expect(await environmentService.deleteEnvironmentByUser(ENV_ID, OWNER)).toBe(true);
    expect(destroy).toHaveBeenCalled();
  });
});

describe("every ownership-scoped query carries user_id", () => {
  // Guards against the scoping being dropped from one method while the others
  // keep it - the failure mode would be a single leaky endpoint, not a broken suite.
  it.each([
    [
      "getEnvironmentByIdAndUser",
      () => environmentService.getEnvironmentByIdAndUser(ENV_ID, OWNER),
    ],
    [
      "updateEnvironmentByUser",
      () => environmentService.updateEnvironmentByUser(ENV_ID, OWNER, { region: "eu-west-1" }),
    ],
    ["deleteEnvironmentByUser", () => environmentService.deleteEnvironmentByUser(ENV_ID, OWNER)],
  ])("%s scopes by user_id", async (_name, call) => {
    await call();

    expect(Environment.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ user_id: OWNER }) }),
    );
  });

  it("getUserEnvironments scopes by user_id", async () => {
    await environmentService.getUserEnvironments(OWNER);

    expect(Environment.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ user_id: OWNER }) }),
    );
  });
});
