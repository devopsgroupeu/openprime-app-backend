// tests/pushPinnedHostKeys.test.js
// OP-258 (D29): every push started from an empty known_hosts with
// StrictHostKeyChecking=accept-new, so github.com and gitlab.com were trusted
// on first use on every single push. Their published keys must already be in
// the known_hosts file when ssh starts; with accept-new, ssh then refuses a
// changed key for them (checked against OpenSSH, see the PR).
//
// Real pushInfrastructure, real git; ssh is the stand-in from
// tests/helpers/fakeSshRemote.js, which snapshots the file it was given.
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { createFakeSshRemote } = require("./helpers/fakeSshRemote");
const { PUBLISHED_FINGERPRINTS, fingerprintsOf } = require("./hostKeyFingerprints");
const environmentService = jest.requireActual("../src/services/environmentService");

jest.setTimeout(30000);

let root;
let remote;
let savedPath;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "op258-"));
  savedPath = process.env.PATH;
  remote = await createFakeSshRemote(root);
  process.env.PATH = `${remote.binDir}${path.delimiter}${savedPath}`;
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(root, { recursive: true, force: true });
});

async function push() {
  const zip = new AdmZip();
  zip.addFile("terraform/aws/main.tf", Buffer.from("generated\n"));
  await environmentService.pushInfrastructure(zip.toBuffer(), {
    url: remote.url,
    branch: "main",
    sshKey: "not-a-real-key",
  });
}

describe("a push starts ssh with the providers' published host keys", () => {
  it("has every published github.com and gitlab.com key in known_hosts when ssh starts", async () => {
    await push();

    const knownHosts = remote.readKnownHostsAtSsh();
    expect(knownHosts).not.toBeNull();
    const found = fingerprintsOf(knownHosts);
    for (const [host, fingerprints] of Object.entries(PUBLISHED_FINGERPRINTS)) {
      expect(
        found
          .filter((k) => k.host === host)
          .map((k) => k.fingerprint)
          .sort(),
      ).toEqual([...fingerprints].sort());
    }
  });

  it("pins nothing else, so any other host is still trusted on first use", async () => {
    await push();

    const hosts = new Set(fingerprintsOf(remote.readKnownHostsAtSsh() || "").map((k) => k.host));
    expect([...hosts].sort()).toEqual(["github.com", "gitlab.com"]);
  });

  it("keeps accept-new pointed at that same file", async () => {
    await push();

    const command = remote.readSshEnv().GIT_SSH_COMMAND;
    expect(command).toMatch(/-o StrictHostKeyChecking=accept-new\b/);
    expect(command).toMatch(/-o UserKnownHostsFile=\S+known_hosts\b/);
  });
});
