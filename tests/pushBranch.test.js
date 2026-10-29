// tests/pushBranch.test.js
// OP-181(1): push landed on the clone's default branch while the configured
// branch was used only as the ArgoCD targetRevision — "pushed successfully"
// plus a cluster watching a branch that never received the commit.
//
// These run the real pushInfrastructure against a real bare repository rather
// than a mocked simple-git, because the whole defect lives in git's behaviour,
// not in our control flow. They used to replay the clone/checkout sequence by
// hand; since the clone became shallow and single-branch (OP-262) that replica
// would no longer be what production runs, so the push goes through a
// stand-in ssh instead (tests/helpers/fakeSshRemote.js).
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { createFakeSshRemote } = require("./helpers/fakeSshRemote");
const environmentService = jest.requireActual("../src/services/environmentService");

jest.setTimeout(30000);

let root;
let remote;
let savedPath;

/** Push a generated tree of `files` to `targetBranch` through the real service. */
async function pushGenerated(targetBranch, files) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, Buffer.from(content));
  }
  return environmentService.pushInfrastructure(zip.toBuffer(), {
    url: remote.url,
    branch: targetBranch,
    sshKey: "not-a-real-key",
  });
}

/** Read a file from a branch of the bare repo — i.e. what the customer's CI sees. */
const fileOnBranch = (branch, file) => remote.fileOnBranch(branch, file);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "op181-"));
  remote = await createFakeSshRemote(root);
  savedPath = process.env.PATH;
  process.env.PATH = `${remote.binDir}${path.delimiter}${savedPath}`;
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("push lands on the configured branch", () => {
  it("creates the branch when it does not exist remotely", async () => {
    await pushGenerated("openprime-dev", { "terraform/aws/main.tf": "generated\n" });

    expect(await fileOnBranch("openprime-dev", "terraform/aws/main.tf")).toBe("generated\n");
    // The regression: this used to be where the commit landed instead.
    expect(await fileOnBranch("main", "terraform/aws/main.tf")).toBeNull();
  });

  it("uses an existing remote branch rather than forking a new history", async () => {
    await pushGenerated("staging", { "terraform/aws/main.tf": "generated\n" });

    expect(await fileOnBranch("staging", "terraform/aws/main.tf")).toBe("generated\n");
    // The customer's own file is still there — we added to their branch.
    expect(await fileOnBranch("staging", "README.md")).toBe("customer file\n");
    expect(await fileOnBranch("main", "terraform/aws/main.tf")).toBeNull();
  });

  it("still pushes to the default branch when none is configured", async () => {
    await pushGenerated(null, { "terraform/aws/main.tf": "generated\n" });
    expect(await fileOnBranch("main", "terraform/aws/main.tf")).toBe("generated\n");
  });

  it("treats HEAD as 'no preference', matching the ArgoCD targetRevision default", async () => {
    await pushGenerated("HEAD", { "terraform/aws/main.tf": "generated\n" });
    expect(await fileOnBranch("main", "terraform/aws/main.tf")).toBe("generated\n");
  });
});

describe("overwrite reporting", () => {
  it("reports a customer file the generated tree replaced", async () => {
    const result = await pushGenerated("main", { "README.md": "replaced by generation\n" });

    expect(result.overwritten).toEqual(["README.md"]);
    expect(await fileOnBranch("main", "README.md")).toBe("replaced by generation\n");
  });

  it("reports nothing when only new files are added", async () => {
    const result = await pushGenerated("main", { "terraform/aws/main.tf": "generated\n" });
    expect(result.overwritten).toEqual([]);
  });

  it("reports only the files that changed, not every file present", async () => {
    const result = await pushGenerated("main", {
      "README.md": "replaced\n",
      "terraform/aws/main.tf": "generated\n",
    });
    expect(result.overwritten).toEqual(["README.md"]);
  });
});
