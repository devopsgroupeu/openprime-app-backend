// src/validators/gitUrl.js
//
// The repository URL is user-supplied in the wizard and is handed straight to
// `git clone` when infrastructure is pushed. Git treats the URL as more than an
// address: the scheme selects a *transport*, and some transports read local
// files or run commands. See OP-175.
//
// Two of the vectors the audit listed are already covered by the stack and are
// deliberately NOT re-implemented here:
//   - `ext::sh -c ...` transport injection — git refuses `ext` unless explicitly
//     allowed (default since 2.12); verified against the git in the runtime image.
//   - a leading `-` parsed as a git option — simple-git rejects it itself
//     ("potential exploit argument blocked"); verified against the pinned version.
// What is NOT covered anywhere is the scheme: `file://` and bare local paths
// clone happily, so those are what this module exists to stop.

// [user@]host:path — the scp-like form the wizard asks for
// (git@github.com:org/repo.git). Rejected if the part before ':' contains a
// slash, which would make it a local relative path rather than a host.
const SCP_LIKE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:(?!\/)[A-Za-z0-9._\-~/]+$/;

const ALLOWED_SCHEMES = new Set(["https:", "ssh:"]);

// Never a legitimate git remote, and the addresses that make SSRF interesting.
// Private ranges are deliberately allowed: self-hosted GitLab on an internal
// network is a first-class use case for this product.
const BLOCKED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const LINK_LOCAL = /^169\.254\./; // cloud instance metadata

function reject(reason) {
  return { valid: false, reason };
}

/**
 * Validate a user-supplied git repository URL.
 *
 * @param {unknown} url
 * @returns {{valid: boolean, reason?: string}}
 */
function validateGitRepositoryUrl(url) {
  if (typeof url !== "string" || !url.trim()) {
    return reject("Repository URL is required");
  }

  const value = url.trim();

  if (value !== url) {
    // Surrounding whitespace is almost always a paste artefact, but leading
    // whitespace could also hide a leading '-', so normalise before judging.
    return validateGitRepositoryUrl(value);
  }

  if (value.startsWith("-")) {
    return reject("Repository URL must not start with '-'");
  }

  // Transport helpers (`ext::`, `transport::address`) are selected by a '::'
  // before any path separator.
  const doubleColon = value.indexOf("::");
  if (doubleColon !== -1 && (value.indexOf("/") === -1 || doubleColon < value.indexOf("/"))) {
    return reject("Repository URL must not use a git transport helper");
  }

  if (SCP_LIKE.test(value)) {
    const host = value.slice(value.indexOf("@") + 1, value.indexOf(":"));
    return isBlockedHost(host)
      ? reject(`Repository host '${host}' is not allowed`)
      : { valid: true };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return reject("Repository URL must be an https:// or ssh:// URL, or git@host:path");
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return reject(
      `Repository URL scheme '${parsed.protocol.replace(":", "")}' is not allowed; use https or ssh`,
    );
  }

  if (!parsed.hostname) {
    return reject("Repository URL is missing a host");
  }

  if (isBlockedHost(parsed.hostname)) {
    return reject(`Repository host '${parsed.hostname}' is not allowed`);
  }

  return { valid: true };
}

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase();
  return BLOCKED_HOSTS.has(host) || LINK_LOCAL.test(host);
}

module.exports = { validateGitRepositoryUrl };
