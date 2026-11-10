// tests/pinnedHostKeys.test.js
// OP-258 (D29): the pinned keys must be the providers' real keys and a file
// OpenSSH itself reads. The fingerprints come from the providers' own
// listings (tests/hostKeyFingerprints.js), not from the keys under test.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { PINNED_KNOWN_HOSTS } = require("../src/config/pinnedHostKeys");
const { PUBLISHED_FINGERPRINTS, fingerprintsOf } = require("./hostKeyFingerprints");

const pinned = fingerprintsOf(PINNED_KNOWN_HOSTS.join("\n"));

describe("pinned host keys", () => {
  it.each(Object.entries(PUBLISHED_FINGERPRINTS))(
    "%s: exactly the published fingerprints",
    (host, fingerprints) => {
      expect(
        pinned
          .filter((k) => k.host === host)
          .map((k) => k.fingerprint)
          .sort(),
      ).toEqual([...fingerprints].sort());
    },
  );

  describe("as OpenSSH reads them", () => {
    let file;
    beforeAll(() => {
      file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "op258-kh-")), "known_hosts");
      fs.writeFileSync(file, `${PINNED_KNOWN_HOSTS.join("\n")}\n`);
    });
    afterAll(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

    const lookup = (host) =>
      spawnSync("ssh-keygen", ["-F", host, "-f", file], { encoding: "utf8" });

    it.each(["github.com", "gitlab.com"])("ssh-keygen -F %s finds its three keys", (host) => {
      const result = lookup(host);

      expect(result.status).toBe(0);
      expect(result.stdout.split("\n").filter((l) => l.startsWith(`${host} `))).toHaveLength(3);
    });

    it("control: a host that is not pinned is not found", () => {
      expect(lookup("git.example.test").status).toBe(1);
    });
  });
});
