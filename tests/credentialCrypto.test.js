// Cloud credentials are the most sensitive thing this service stores: they are
// long-lived AWS keys belonging to a customer. Until now the AES-256-GCM code
// lived inline in the CloudCredential getter/setter, which tests/setup.js mocks
// away wholesale, so the cipher had never been executed by a single test.
//
// OP-192 asks for the round trip. These tests exercise the real crypto.

const {
  encryptCredentials,
  decryptCredentials,
  looksEncrypted,
} = require("../src/utils/credentialCrypto");

const SECRET = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("credential encryption round trip", () => {
  it("returns exactly what was stored", () => {
    expect(decryptCredentials(encryptCredentials(SECRET))).toEqual(SECRET);
  });

  it("never emits the plaintext secret into the stored value", () => {
    const stored = encryptCredentials(SECRET);

    expect(stored).not.toContain(SECRET.secretAccessKey);
    expect(stored).not.toContain(SECRET.accessKeyId);
  });

  it("produces a different ciphertext every time for the same input", () => {
    // A fixed IV would make identical credentials produce identical ciphertext,
    // leaking that two users hold the same key without decrypting anything.
    const a = encryptCredentials(SECRET);
    const b = encryptCredentials(SECRET);

    expect(a).not.toEqual(b);
    expect(decryptCredentials(a)).toEqual(decryptCredentials(b));
  });

  it("survives values that would break naive string handling", () => {
    const awkward = { note: 'quote " backslash \\ newline \n colon : end', nested: { n: 1 } };

    expect(decryptCredentials(encryptCredentials(awkward))).toEqual(awkward);
  });
});

describe("credential decryption rejects anything it cannot authenticate", () => {
  it("refuses a tampered ciphertext instead of returning altered data", () => {
    const [iv, tag, ciphertext] = encryptCredentials(SECRET).split(":");
    const flipped = ciphertext.startsWith("a")
      ? `b${ciphertext.slice(1)}`
      : `a${ciphertext.slice(1)}`;

    expect(decryptCredentials(`${iv}:${tag}:${flipped}`)).toBeNull();
  });

  it("refuses a tampered auth tag", () => {
    const [iv, tag, ciphertext] = encryptCredentials(SECRET).split(":");
    const flipped = tag.startsWith("a") ? `b${tag.slice(1)}` : `a${tag.slice(1)}`;

    expect(decryptCredentials(`${iv}:${flipped}:${ciphertext}`)).toBeNull();
  });

  // Without an explicit authTagLength, Node 24 (the runtime in the Dockerfile)
  // accepts a GCM tag as short as 4 bytes, so a forger only has to guess 32 bits.
  it.each([4, 8, 12, 15])("refuses an auth tag truncated to %i bytes", (bytes) => {
    const [iv, tag, ciphertext] = encryptCredentials(SECRET).split(":");

    expect(decryptCredentials(`${iv}:${tag.slice(0, bytes * 2)}:${ciphertext}`)).toBeNull();
  });

  it("refuses to decrypt with a different key", () => {
    const stored = encryptCredentials(SECRET);
    const realKey = process.env.CREDENTIALS_ENCRYPTION_KEY;

    process.env.CREDENTIALS_ENCRYPTION_KEY = "f".repeat(64);
    try {
      expect(decryptCredentials(stored)).toBeNull();
    } finally {
      process.env.CREDENTIALS_ENCRYPTION_KEY = realKey;
    }
  });

  it.each([["not-encrypted"], ["only:two"], [":::"], ["zz:zz:zz"]])(
    "refuses the malformed stored value %p",
    (malformed) => {
      expect(decryptCredentials(malformed)).toBeNull();
    },
  );

  it("returns null when nothing is stored", () => {
    expect(decryptCredentials(null)).toBeNull();
    expect(decryptCredentials("")).toBeNull();
  });
});

// A value as it is stored today: 16-byte IV, full 16-byte tag. Produced with
// Python's `cryptography` AESGCM under the tests/setup.js key, not with this
// module, so a change to both encrypt and decrypt cannot pass unnoticed.
describe("credentials already stored keep decrypting", () => {
  const STORED =
    "000102030405060708090a0b0c0d0e0f:5888829ce54891e1cc4999bd7cf78445:" +
    "e6499fb8a3d26e777bb1c3ba1852576231fb144bbc04b40f528e5841c2c07401a97ca59d81fee0b158bc4aae6e" +
    "f1eed660ff6b70a4a382537045807cb555128c1b816558213522d14612d38c9239c95c05946ce84c43bed10bd8" +
    "085f9dc2b339f8dc57";

  it("decrypts a value encrypted outside this module", () => {
    expect(decryptCredentials(STORED)).toEqual(SECRET);
  });

  it("refuses the same value with its tag cut to 4 bytes", () => {
    const [iv, tag, ciphertext] = STORED.split(":");

    expect(decryptCredentials(`${iv}:${tag.slice(0, 8)}:${ciphertext}`)).toBeNull();
  });
});

describe("the key is read per call, not captured at require time", () => {
  it("fails loudly when the key is missing rather than encrypting with nothing", () => {
    const realKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
    delete process.env.CREDENTIALS_ENCRYPTION_KEY;

    try {
      expect(() => encryptCredentials(SECRET)).toThrow(/CREDENTIALS_ENCRYPTION_KEY/);
    } finally {
      process.env.CREDENTIALS_ENCRYPTION_KEY = realKey;
    }
  });
});

describe("looksEncrypted", () => {
  it("recognises what encryptCredentials produces", () => {
    expect(looksEncrypted(encryptCredentials("anything"))).toBe(true);
  });

  it.each([
    [
      "a PEM private key",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
    ],
    ["a plain string", "hello"],
    ["empty", ""],
    ["null", null],
    ["a number", 42],
    ["too few segments", "abcd:efgh"],
    ["non-hex segments", "zzzz:yyyy:xxxx"],
    ["short iv", "00:11223344556677889900112233445566:aabb"],
  ])("rejects %s", (_label, value) => {
    expect(looksEncrypted(value)).toBe(false);
  });

  // The whole point: the migration must be able to tell these apart without
  // calling decryptCredentials, which logs an error on every failure.
  it("separates ciphertext from plaintext without a decrypt attempt", () => {
    const plaintext = "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----";
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(looksEncrypted(plaintext)).toBe(false);
    expect(looksEncrypted(encryptCredentials(plaintext))).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
