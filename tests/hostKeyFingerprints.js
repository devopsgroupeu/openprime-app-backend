// SHA256 fingerprints the providers publish for their SSH host keys, copied
// from their own listings (not computed from our pinned keys), so the pinned
// keys are checked against an independent source:
// - GitHub: https://api.github.com/meta, `ssh_key_fingerprints`
// - GitLab: https://docs.gitlab.com/user/gitlab_com/#ssh-host-keys-fingerprints
// Both matched a live ssh-keyscan on 2026-11-10.
const crypto = require("node:crypto");

const PUBLISHED_FINGERPRINTS = {
  "github.com": [
    "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
    "SHA256:p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM",
    "SHA256:uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s",
  ],
  "gitlab.com": [
    "SHA256:eUXGGm1YGsMAS7vkcx6JOJdOGHPem5gQp4taiCfCLB8",
    "SHA256:HbW3g8zUjNSksFbqTiUWPWg2Bq1x8xdGUrliXFzSnUw",
    "SHA256:ROQFvPThGrW4RuWLoL9tq9I9zJ42fK4XywyRtbOz/EQ",
  ],
};

/** { host, fingerprint } for every key line in known_hosts text, as ssh-keygen -l prints it. */
function fingerprintsOf(knownHosts) {
  return knownHosts
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [host, , blob] = line.trim().split(/\s+/);
      const digest = crypto
        .createHash("sha256")
        .update(Buffer.from(blob, "base64"))
        .digest("base64");
      return { host, fingerprint: `SHA256:${digest.replace(/=+$/, "")}` };
    });
}

module.exports = { PUBLISHED_FINGERPRINTS, fingerprintsOf };
