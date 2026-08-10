// tests/deactivateUser.test.js
// The self-deactivation guard compared the Keycloak subject (req.user.id) against
// the database primary key carried in :userId. Those are different identifiers by
// construction — every other controller translates one to the other via
// getUserByKeycloakId — so the guard could never fire and an admin could
// deactivate their own account. See OP-192.
const userController = require("../src/controllers/userController");
const userService = require("../src/services/userService");

const CALLER_KEYCLOAK_ID = "kc-sub-abc";
const CALLER_DB_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_DB_ID = "22222222-2222-2222-2222-222222222222";

const makeRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const makeReq = (userId) => ({
  params: { userId },
  user: { id: CALLER_KEYCLOAK_ID },
  log: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
});

describe("deactivateUser — self-deactivation guard", () => {
  beforeEach(() => {
    userService.getUserByKeycloakId = jest
      .fn()
      .mockResolvedValue({ id: CALLER_DB_ID, username: "admin" });
    userService.deactivateUser = jest
      .fn()
      .mockImplementation((id) =>
        Promise.resolve({ id, username: "target", is_active: false }),
      );
  });

  it("rejects deactivating your own account with 400", async () => {
    const res = makeRes();
    await userController.deactivateUser(makeReq(CALLER_DB_ID), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Cannot deactivate your own account",
    });
    expect(userService.deactivateUser).not.toHaveBeenCalled();
  });

  it("resolves the caller by Keycloak id rather than trusting req.user.id as a DB id", async () => {
    // The regression this guards: comparing :userId to the raw Keycloak subject.
    // CALLER_DB_ID !== CALLER_KEYCLOAK_ID, so the old comparison let the request
    // straight through to deactivateUser.
    const res = makeRes();
    await userController.deactivateUser(makeReq(CALLER_DB_ID), res);

    expect(userService.getUserByKeycloakId).toHaveBeenCalledWith(CALLER_KEYCLOAK_ID);
    expect(CALLER_DB_ID).not.toEqual(CALLER_KEYCLOAK_ID);
  });

  it("still allows deactivating a different user", async () => {
    const res = makeRes();
    await userController.deactivateUser(makeReq(OTHER_DB_ID), res);

    expect(userService.deactivateUser).toHaveBeenCalledWith(OTHER_DB_ID);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "User deactivated successfully" }),
    );
  });

  it("does not block on an unresolvable caller, and does not throw", async () => {
    userService.getUserByKeycloakId = jest.fn().mockResolvedValue(null);
    const res = makeRes();
    await userController.deactivateUser(makeReq(OTHER_DB_ID), res);

    expect(userService.deactivateUser).toHaveBeenCalledWith(OTHER_DB_ID);
    expect(res.status).not.toHaveBeenCalledWith(500);
  });

  it("returns 500 when the service fails", async () => {
    userService.deactivateUser = jest.fn().mockRejectedValue(new Error("boom"));
    const res = makeRes();
    await userController.deactivateUser(makeReq(OTHER_DB_ID), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
