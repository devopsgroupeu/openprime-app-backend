// tests/redact.test.js
// Locks in that the log redaction layer strips every secret shape we care about:
// SSH keys, cloud credentials, tokens and passwords (however the key is cased or
// separated), and credentials embedded in connection-string URLs — while leaving
// non-sensitive data intact. This is the control that keeps secrets out of Loki.
const { redact, maskUrlAuth, isSensitiveKey } = require("../src/utils/redact");

describe("isSensitiveKey", () => {
  it.each([
    "sshKey",
    "SSH_KEY",
    "ssh-key",
    "privateKey",
    "credentials",
    "clientSecret",
    "secretAccessKey",
    "password",
    "passwd",
    "accessKeyId",
    "access_key",
    "apiKey",
    "token",
    "accessToken",
  ])("flags %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["name", "region", "provider", "environmentId", "username", "path", "keycloakId"])(
    "leaves %s alone",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("maskUrlAuth", () => {
  it("masks user:pass in an https URL", () => {
    expect(maskUrlAuth("https://alice:ghp_secretpat@github.com/org/repo.git")).toBe(
      "https://***:***@github.com/org/repo.git",
    );
  });

  it("masks credentials inside a longer message", () => {
    expect(maskUrlAuth("Executing command: git clone https://u:p@host/x /tmp/x")).toBe(
      "Executing command: git clone https://***:***@host/x /tmp/x",
    );
  });

  it("leaves credential-free URLs and plain strings untouched", () => {
    expect(maskUrlAuth("https://github.com/org/repo.git")).toBe("https://github.com/org/repo.git");
    expect(maskUrlAuth("no url here")).toBe("no url here");
  });

  it("passes non-strings through unchanged", () => {
    expect(maskUrlAuth(42)).toBe(42);
    expect(maskUrlAuth(undefined)).toBeUndefined();
  });
});

describe("redact", () => {
  it("redacts sensitive keys at any depth and preserves the rest", () => {
    const input = {
      name: "prod",
      region: "eu-west-1",
      git_repository: { url: "https://github.com/org/repo.git", sshKey: "-----BEGIN KEY-----" },
      credentials: { accessKeyId: "AKIA...", secretAccessKey: "abc123" },
      nested: { deep: { password: "hunter2", keep: "yes" } },
    };
    expect(redact(input)).toEqual({
      name: "prod",
      region: "eu-west-1",
      git_repository: { url: "https://github.com/org/repo.git", sshKey: "[REDACTED]" },
      credentials: "[REDACTED]",
      nested: { deep: { password: "[REDACTED]", keep: "yes" } },
    });
  });

  it("redacts sensitive keys inside arrays", () => {
    const input = {
      users: [
        { username: "a", token: "t1" },
        { username: "b", token: "t2" },
      ],
    };
    expect(redact(input)).toEqual({
      users: [
        { username: "a", token: "[REDACTED]" },
        { username: "b", token: "[REDACTED]" },
      ],
    });
  });

  it("masks credential URLs found in string values", () => {
    expect(redact({ remote: "https://u:p@host/repo.git" })).toEqual({
      remote: "https://***:***@host/repo.git",
    });
  });

  it("does not mutate the input object", () => {
    const input = { sshKey: "secret" };
    redact(input);
    expect(input.sshKey).toBe("secret");
  });

  it("handles primitives, null, and circular references without throwing", () => {
    expect(redact("plain")).toBe("plain");
    expect(redact(7)).toBe(7);
    expect(redact(null)).toBeNull();
    const cyclic = { name: "x" };
    cyclic.self = cyclic;
    expect(redact(cyclic)).toEqual({ name: "x", self: "[Circular]" });
  });
});
