// tests/pushRepositoryAddress.test.js
// OP-262 (D27): the repository URL is checked as a string when it is saved,
// so a host written in a form the string check does not recognise (git@127.1:)
// or a name that resolves to loopback or metadata reached git unchallenged.
// pushInfrastructure now checks where the host resolves before git connects.
//
// Real pushInfrastructure through a stand-in ssh that would happily serve the
// push (tests/helpers/fakeSshRemote.js): it ignores the host, so only the
// address check stands between this URL and a successful push.
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { createFakeSshRemote } = require("./helpers/fakeSshRemote");
const environmentService = jest.requireActual("../src/services/environmentService");

jest.setTimeout(30000);

let root;
let savedPath;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "op262-ssrf-"));
  savedPath = process.env.PATH;
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(root, { recursive: true, force: true });
});

it("refuses a host that resolves to loopback before git runs at all", async () => {
  const remote = await createFakeSshRemote(root);
  process.env.PATH = `${remote.binDir}${path.delimiter}${savedPath}`;

  const zip = new AdmZip();
  zip.addFile("terraform/aws/main.tf", Buffer.from("generated\n"));

  await expect(
    environmentService.pushInfrastructure(zip.toBuffer(), {
      url: "git@127.1:org/repo.git",
      branch: "main",
      sshKey: "not-a-real-key",
    }),
  ).rejects.toThrow(/127\.0\.0\.1/);

  expect(remote.readGitInvocations()).toEqual([]);
  expect(await remote.fileOnBranch("main", "terraform/aws/main.tf")).toBeNull();
});
