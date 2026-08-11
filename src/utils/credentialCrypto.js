const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 16;

// Read the key per call rather than once at module load. This is what makes the
// round-trip testable: the model used to capture process.env at require() time,
// so a test could never exercise the real cipher without controlling module load
// order, and tests/setup.js mocks the model away instead.
function getKey() {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY is not set");
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypt a JSON-serialisable value into the stored `iv:authTag:ciphertext` form.
 */
function encryptCredentials(value) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(JSON.stringify(value), "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Reverse encryptCredentials. Returns null for anything that does not decrypt
 * cleanly — including a tampered authTag, the wrong key and a malformed string.
 *
 * Returning null rather than throwing is the behaviour the model getter has
 * always had; callers cannot currently tell "no credentials stored" apart from
 * "stored credentials failed to decrypt". Preserved deliberately here so this
 * extraction changes nothing, and recorded on OP-192 as its own decision.
 */
function decryptCredentials(stored) {
  if (!stored) return null;

  try {
    const parts = stored.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encryptedText = Buffer.from(parts[2], "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return JSON.parse(decrypted);
  } catch (error) {
    console.error("Error decrypting credentials:", error);
    return null;
  }
}

module.exports = { encryptCredentials, decryptCredentials };
