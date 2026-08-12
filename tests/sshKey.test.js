// tests/sshKey.test.js
// OP-216: the customer's git deploy key is write-capable against their
// infrastructure repo. These cover the three forms it may take -- stored
// (encrypted), in-process (plaintext, push path only) and on the wire
// (redacted) -- plus the fingerprint the UI shows in place of the key.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  sshKeyFingerprint,
  hasKeyMaterial,
  encryptGitRepository,
  decryptGitRepository,
  redactGitRepository,
  mergeGitRepository,
} = require("../src/utils/sshKey");

/** Generate a real key pair and read back what ssh-keygen itself calls its fingerprint. */
function generateKey(type, extraArgs = [], passphrase = "") {
  const file = path.join(
    os.tmpdir(),
    `op216-${type}-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  execFileSync("ssh-keygen", ["-t", type, ...extraArgs, "-N", passphrase, "-f", file], {
    stdio: "ignore",
  });
  const privateKey = fs.readFileSync(file, "utf8");
  const fingerprint = execFileSync("ssh-keygen", ["-lf", `${file}.pub`])
    .toString()
    .split(" ")[1];
  fs.unlinkSync(file);
  fs.unlinkSync(`${file}.pub`);
  return { privateKey, fingerprint };
}

describe("sshKeyFingerprint", () => {
  // Every modern ssh-keygen writes the OPENSSH container regardless of key
  // type, and node's crypto cannot parse it -- so these three are the formats
  // that actually arrive from customers, not an exotic edge case.
  it.each([
    ["ed25519", []],
    ["rsa", ["-b", "2048"]],
    ["ecdsa", ["-b", "256"]],
  ])("matches ssh-keygen for an OpenSSH-format %s key", (type, extraArgs) => {
    const { privateKey, fingerprint } = generateKey(type, extraArgs);
    expect(sshKeyFingerprint(privateKey)).toBe(fingerprint);
  });

  it("matches ssh-keygen for a legacy PEM RSA key", () => {
    const { privateKey, fingerprint } = generateKey("rsa", ["-b", "2048", "-m", "PEM"]);
    expect(privateKey).toContain("BEGIN RSA PRIVATE KEY");
    expect(sshKeyFingerprint(privateKey)).toBe(fingerprint);
  });

  it("works on a passphrase-protected key, since only the public half is read", () => {
    const { privateKey, fingerprint } = generateKey("ed25519", [], "hunter2");
    expect(sshKeyFingerprint(privateKey)).toBe(fingerprint);
  });

  it("distinguishes two different keys", () => {
    const a = generateKey("ed25519");
    const b = generateKey("ed25519");
    expect(sshKeyFingerprint(a.privateKey)).not.toBe(sshKeyFingerprint(b.privateKey));
  });

  it.each([
    ["null", null],
    ["empty string", ""],
    ["not a key", "hello"],
    ["non-string", { key: "value" }],
    [
      "truncated OpenSSH body",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
    ],
  ])("returns null rather than throwing for %s", (_label, input) => {
    expect(sshKeyFingerprint(input)).toBeNull();
  });
});

describe("hasKeyMaterial", () => {
  it.each([
    ["a key", "-----BEGIN OPENSSH PRIVATE KEY-----", true],
    ["empty string", "", false],
    ["whitespace only", "   \n ", false],
    ["undefined", undefined, false],
    ["null", null, false],
  ])("%s -> %s", (_label, value, expected) => {
    expect(hasKeyMaterial(value)).toBe(expected);
  });
});

describe("git_repository storage form", () => {
  const git = { url: "git@github.com:acme/infra.git", branch: "main", sshKey: "PRIVATE-KEY" };

  it("round-trips the key", () => {
    expect(decryptGitRepository(encryptGitRepository(git)).sshKey).toBe("PRIVATE-KEY");
  });

  it("stores no plaintext key", () => {
    expect(JSON.stringify(encryptGitRepository(git))).not.toContain("PRIVATE-KEY");
  });

  it("leaves url and branch as readable JSONB", () => {
    const stored = encryptGitRepository(git);
    expect(stored.url).toBe(git.url);
    expect(stored.branch).toBe("main");
  });

  it("uses a fresh IV per encryption", () => {
    expect(encryptGitRepository(git).sshKey).not.toBe(encryptGitRepository(git).sshKey);
  });

  it.each([
    ["null", null],
    ["no sshKey member", { url: "git@github.com:acme/infra.git" }],
    ["empty sshKey", { url: "x", sshKey: "" }],
  ])("passes through %s untouched", (_label, input) => {
    expect(encryptGitRepository(input)).toEqual(input);
    expect(decryptGitRepository(input)).toEqual(input);
  });
});

describe("git_repository wire form", () => {
  const key = generateKey("ed25519");
  const git = { url: "git@github.com:acme/infra.git", branch: "main", sshKey: key.privateKey };

  it("contains no key material", () => {
    expect(JSON.stringify(redactGitRepository(git))).not.toContain(key.privateKey);
    expect(redactGitRepository(git).sshKey).toBeUndefined();
  });

  it("reports the key as configured, with its real fingerprint", () => {
    const wire = redactGitRepository(git);
    expect(wire.sshKeyConfigured).toBe(true);
    expect(wire.sshKeyFingerprint).toBe(key.fingerprint);
  });

  it("keeps url and branch, which the UI still needs", () => {
    expect(redactGitRepository(git)).toMatchObject({ url: git.url, branch: "main" });
  });

  it("reports not-configured when no key is stored", () => {
    const wire = redactGitRepository({ url: "git@github.com:acme/infra.git" });
    expect(wire.sshKeyConfigured).toBe(false);
    expect(wire.sshKeyFingerprint).toBeNull();
  });

  it("passes null through", () => {
    expect(redactGitRepository(null)).toBeNull();
  });

  // Redaction runs on the stored form in one real path (a row read straight
  // back after a write), so it must not leak ciphertext either.
  it("does not expose the ciphertext", () => {
    const stored = encryptGitRepository(git);
    expect(JSON.stringify(redactGitRepository(stored))).not.toContain(stored.sshKey);
  });
});

describe("mergeGitRepository (blank means keep)", () => {
  const stored = { url: "git@github.com:acme/infra.git", branch: "main", sshKey: "STORED-KEY" };

  it("keeps the stored key when the wizard posts a blank one back", () => {
    // The API never returns the key, so an unmodified edit posts "". Treating
    // that as "erase" would break push for every environment edited after
    // OP-216 shipped -- this is the regression the whole ticket risks.
    const merged = mergeGitRepository(stored, { ...stored, sshKey: "" });
    expect(merged.sshKey).toBe("STORED-KEY");
  });

  it.each([
    ["undefined", undefined],
    ["missing", null],
    ["whitespace", "  \n "],
  ])("keeps the stored key when the submitted key is %s", (_label, sshKey) => {
    expect(mergeGitRepository(stored, { ...stored, sshKey }).sshKey).toBe("STORED-KEY");
  });

  it("replaces the key when a new one is supplied", () => {
    expect(mergeGitRepository(stored, { ...stored, sshKey: "NEW-KEY" }).sshKey).toBe("NEW-KEY");
  });

  it("applies other edits while keeping the key", () => {
    const merged = mergeGitRepository(stored, { url: "git@github.com:acme/other.git", sshKey: "" });
    expect(merged).toMatchObject({ url: "git@github.com:acme/other.git", sshKey: "STORED-KEY" });
  });

  it("leaves the stored value alone when git config is not part of the update", () => {
    expect(mergeGitRepository(stored, undefined)).toBe(stored);
  });

  it("clears git config when explicitly set to null", () => {
    expect(mergeGitRepository(stored, null)).toBeNull();
  });

  it.each(["sshKeyConfigured", "sshKeyFingerprint"])(
    "never stores the wire-only field %s that the UI posts back",
    (field) => {
      // The environment detail page PUTs the object it was given, which is the
      // redacted one. Storing these would leave a fingerprint in the column
      // that goes stale on the next rotation.
      const merged = mergeGitRepository(stored, {
        url: stored.url,
        sshKey: "",
        sshKeyConfigured: true,
        sshKeyFingerprint: "SHA256:stale",
      });
      expect(merged).not.toHaveProperty(field);
      expect(merged.sshKey).toBe("STORED-KEY");
    },
  );

  it("does not invent a key when none was ever stored", () => {
    expect(
      mergeGitRepository(null, { url: "git@github.com:acme/infra.git", sshKey: "" }).sshKey,
    ).toBeNull();
  });
});
