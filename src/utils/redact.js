// Redaction helpers for structured logging. Prevents secrets (SSH keys, cloud
// credentials, tokens, passwords) from ever reaching log transports (console →
// Loki, or files). Key-based redaction covers structured metadata; URL masking
// covers credentials embedded in connection strings (e.g. https://user:pat@host).

const REDACTED = "[REDACTED]";

// Match sensitive field names after normalising away case and separators, so
// sshKey / SSH_KEY / ssh-key, accessKeyId / access_key all match one pattern.
const SENSITIVE_PATTERN =
  /(sshkey|privatekey|credential|secret|password|passwd|accesskey|apikey|token)/;

function isSensitiveKey(key) {
  const normalized = String(key)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return SENSITIVE_PATTERN.test(normalized);
}

// Mask the `user:pass@` segment of any URL in a string, leaving the rest intact.
const URL_AUTH_RE = /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

function maskUrlAuth(value) {
  return typeof value === "string" ? value.replace(URL_AUTH_RE, "$1***:***@") : value;
}

// Recursively redact a value: sensitive keys become [REDACTED], strings get URL
// masking, everything else is preserved. Returns a copy; never mutates input.
function redact(input, seen = new WeakSet()) {
  if (typeof input === "string") return maskUrlAuth(input);
  if (input === null || typeof input !== "object") return input;
  if (seen.has(input)) return "[Circular]";
  seen.add(input);

  if (Array.isArray(input)) return input.map((item) => redact(item, seen));

  const out = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(value, seen);
  }
  return out;
}

module.exports = { redact, maskUrlAuth, isSensitiveKey, REDACTED };
