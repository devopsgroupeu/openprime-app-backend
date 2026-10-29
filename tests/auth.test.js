// tests/auth.test.js
// setup.js globally mocks the auth middleware, so we pull the REAL module to
// unit-test the pure azp/aud authorization helper introduced with the
// per-client token validation.
process.env.KEYCLOAK_CLIENT_ID = "openprime-app";
const { isAllowedClient } = jest.requireActual("../src/middleware/auth");

// Load a fresh copy of the real module under the given client settings.
function loadAuthWith({ clientId, allowedClients }) {
  const saved = {
    KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID,
    KEYCLOAK_ALLOWED_CLIENTS: process.env.KEYCLOAK_ALLOWED_CLIENTS,
  };
  const set = (name, value) =>
    value === undefined ? delete process.env[name] : (process.env[name] = value);
  set("KEYCLOAK_CLIENT_ID", clientId);
  set("KEYCLOAK_ALLOWED_CLIENTS", allowedClients);
  try {
    let auth;
    jest.isolateModules(() => {
      auth = jest.requireActual("../src/middleware/auth");
    });
    return auth;
  } finally {
    for (const [name, value] of Object.entries(saved)) set(name, value);
  }
}

// OP-260 (D26): with no allow-list the API used to accept a token minted for
// any client in the realm and only log a warning. It must refuse to boot.
describe("client allow-list at boot", () => {
  it("refuses to load when neither KEYCLOAK_CLIENT_ID nor KEYCLOAK_ALLOWED_CLIENTS is set", () => {
    expect(() => loadAuthWith({})).toThrow(/KEYCLOAK_CLIENT_ID/);
  });

  it("refuses to load when the configured list holds no client", () => {
    expect(() => loadAuthWith({ clientId: " , " })).toThrow(/KEYCLOAK_CLIENT_ID/);
    expect(() => loadAuthWith({ allowedClients: "," })).toThrow(/KEYCLOAK_CLIENT_ID/);
  });

  it("loads with KEYCLOAK_CLIENT_ID or KEYCLOAK_ALLOWED_CLIENTS", () => {
    expect(loadAuthWith({ clientId: "openprime-app" }).authenticateToken).toEqual(
      expect.any(Function),
    );
    expect(
      loadAuthWith({ allowedClients: "openprime-app,openprime-admin" }).authenticateToken,
    ).toEqual(expect.any(Function));
  });
});

describe("isAllowedClient (azp/aud validation)", () => {
  const allowed = ["openprime-app"];

  it("accepts a token whose azp is an allowed client", () => {
    expect(isAllowedClient({ azp: "openprime-app", aud: "account" }, allowed)).toBe(true);
  });

  it("accepts a token whose aud (string) is an allowed client", () => {
    expect(isAllowedClient({ aud: "openprime-app" }, allowed)).toBe(true);
  });

  it("accepts a token whose aud (array) contains an allowed client", () => {
    expect(isAllowedClient({ azp: "account", aud: ["account", "openprime-app"] }, allowed)).toBe(
      true,
    );
  });

  it("rejects a token minted for a different client", () => {
    expect(isAllowedClient({ azp: "attacker-client", aud: "account" }, allowed)).toBe(false);
  });

  it("rejects when neither azp nor aud matches", () => {
    expect(isAllowedClient({ azp: "other", aud: ["account"] }, allowed)).toBe(false);
    expect(isAllowedClient({}, allowed)).toBe(false);
  });

  it("supports multiple allowed clients", () => {
    const multi = ["openprime-app", "openprime-admin"];
    expect(isAllowedClient({ azp: "openprime-admin" }, multi)).toBe(true);
    expect(isAllowedClient({ azp: "unknown" }, multi)).toBe(false);
  });

  it("accepts nothing when the allow-list is empty", () => {
    expect(isAllowedClient({ azp: "anything" }, [])).toBe(false);
    expect(isAllowedClient({}, [])).toBe(false);
  });
});
