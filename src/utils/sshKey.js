const crypto = require("crypto");
const { encryptCredentials, decryptCredentials } = require("./credentialCrypto");

/**
 * SSH key helpers used to show the user *which* deploy key is configured
 * without ever sending the key material back to the browser.
 */

/** Length-prefixed SSH wire-format string. */
function sshString(buf) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length);
  return Buffer.concat([len, buf]);
}

/**
 * Read the public key out of an OpenSSH private key container.
 *
 * `-----BEGIN OPENSSH PRIVATE KEY-----` is what modern ssh-keygen emits by
 * default for every key type, and Node's crypto cannot parse it. It does not
 * need to: the layout is
 *
 *   "openssh-key-v1\0" | string ciphername | string kdfname | string kdfoptions
 *   | uint32 nkeys | string publickey1 | string encrypted-section
 *
 * and the public key sits in the header, outside the encrypted section. So this
 * works for ed25519/rsa/ecdsa alike and for passphrase-protected keys, without
 * ever touching — or being able to touch — the private half.
 */
function publicKeyFromOpenSSH(pem) {
  const body =
    /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(pem);
  if (!body) return null;

  const buf = Buffer.from(body[1].replace(/\s+/g, ""), "base64");
  const magic = "openssh-key-v1\0";
  if (buf.subarray(0, magic.length).toString("binary") !== magic) return null;

  let offset = magic.length;
  const readString = () => {
    if (offset + 4 > buf.length) throw new RangeError("truncated");
    const len = buf.readUInt32BE(offset);
    offset += 4;
    if (offset + len > buf.length) throw new RangeError("truncated");
    const out = buf.subarray(offset, offset + len);
    offset += len;
    return out;
  };

  readString(); // ciphername
  readString(); // kdfname
  readString(); // kdfoptions
  if (offset + 4 > buf.length) return null;
  const keyCount = buf.readUInt32BE(offset);
  offset += 4;
  if (keyCount < 1) return null;

  return readString();
}

/**
 * Build the SSH wire-format public key for a PEM key (`BEGIN RSA PRIVATE KEY`,
 * `BEGIN PRIVATE KEY`). Legacy next to the OpenSSH container, but still handed
 * out by older CI tooling and by `ssh-keygen -m PEM`.
 */
function publicKeyFromPem(pem) {
  const jwk = crypto.createPublicKey(crypto.createPrivateKey(pem)).export({ format: "jwk" });
  if (jwk.kty !== "RSA") return null;

  // SSH encodes RSA as: string "ssh-rsa" | mpint e | mpint n. An mpint is
  // signed, so a leading high bit needs a zero byte in front of it.
  const mpint = (b64) => {
    let b = Buffer.from(b64, "base64url");
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    b = b.subarray(i);
    return b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b;
  };

  return Buffer.concat([
    sshString(Buffer.from("ssh-rsa")),
    sshString(mpint(jwk.e)),
    sshString(mpint(jwk.n)),
  ]);
}

/**
 * `SHA256:...` fingerprint of the public half of an SSH private key — the same
 * string `ssh-keygen -lf` prints and GitHub/GitLab show next to a deploy key,
 * so the user can confirm the configured key is the one they registered.
 *
 * Returns null for anything unparseable rather than throwing: a fingerprint is
 * a display affordance, and failing to derive one must never block reading an
 * environment.
 */
function sshKeyFingerprint(privateKey) {
  if (!privateKey || typeof privateKey !== "string") return null;

  try {
    const pub = privateKey.includes("OPENSSH PRIVATE KEY")
      ? publicKeyFromOpenSSH(privateKey)
      : publicKeyFromPem(privateKey);
    if (!pub || pub.length === 0) return null;

    return `SHA256:${crypto.createHash("sha256").update(pub).digest("base64").replace(/=+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * True when a value carries actual key material. The wizard posts "" for an
 * untouched field, which must mean "keep what is stored" rather than "erase".
 */
function hasKeyMaterial(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The three transforms below are the whole of the deploy-key handling. They are
 * plain functions rather than model code because tests/setup.js replaces
 * sequelize.define with a bare class, so anything written as a getter/setter or
 * an instance method is mocked away and never executed by the suite -- the same
 * gap that left the cloud-credential cipher untested until OP-192.
 */

/** Storage form: sshKey encrypted, url/branch left as readable JSONB. */
function encryptGitRepository(git) {
  if (!git || typeof git !== "object" || !git.sshKey) return git;
  return { ...git, sshKey: encryptCredentials(git.sshKey) };
}

/** Inverse of encryptGitRepository, for the push path. */
function decryptGitRepository(git) {
  if (!git || typeof git !== "object" || !git.sshKey) return git;
  return { ...git, sshKey: decryptCredentials(git.sshKey) };
}

/**
 * Wire form: no key material, plus enough for the user to recognise which
 * deploy key is configured and cross-check it against the one they registered
 * with their git provider.
 */
function redactGitRepository(git) {
  if (!git || typeof git !== "object") return git;

  const { sshKey, ...rest } = git;
  return {
    ...rest,
    sshKeyConfigured: Boolean(sshKey),
    sshKeyFingerprint: sshKeyFingerprint(sshKey),
  };
}

/**
 * Apply a submitted git repository over the stored one.
 *
 * The API never returns the deploy key, so the wizard cannot post it back on an
 * edit — it sends a blank field. Blank therefore has to mean "keep the stored
 * key"; treating it as "erase" would silently break push for every environment
 * edited after this change. Replacing the key still works: send a non-empty one.
 */
function mergeGitRepository(stored, submitted) {
  if (submitted === undefined) return stored;
  if (submitted === null) return null;

  // sshKeyConfigured/sshKeyFingerprint are things the API *says*, not things it
  // stores. The UI posts the whole environment back on edit, so without this
  // they would round-trip into the JSONB column and become stale the moment the
  // key is rotated. Dropped here, at the boundary, rather than in each caller.
  const { sshKeyConfigured: _c, sshKeyFingerprint: _f, ...clean } = submitted;

  if (hasKeyMaterial(clean.sshKey)) return clean;

  return { ...clean, sshKey: stored?.sshKey ?? null };
}

module.exports = {
  sshKeyFingerprint,
  hasKeyMaterial,
  encryptGitRepository,
  decryptGitRepository,
  redactGitRepository,
  mergeGitRepository,
};
