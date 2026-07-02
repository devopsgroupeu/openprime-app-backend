// tests/auth.test.js
// setup.js globally mocks the auth middleware, so we pull the REAL module to
// unit-test the pure azp/aud authorization helper introduced with the
// per-client token validation.
const { isAllowedClient } = jest.requireActual("../src/middleware/auth");

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

  it("is disabled (accepts anything) when the allow-list is empty", () => {
    expect(isAllowedClient({ azp: "anything" }, [])).toBe(true);
    expect(isAllowedClient({}, [])).toBe(true);
  });
});
