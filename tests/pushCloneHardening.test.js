// tests/pushCloneHardening.test.js
// OP-262 (D81): the customer repository was cloned in full into the pod's
// /tmp, and the generated ZIP was copied over the clone without looking at
// what it held. An entry under .git/ lands in the repository's own metadata,
// where a core.fsmonitor setting runs a command in the worker that holds the
// decrypted deploy key.
//
// Real pushInfrastructure, real git, real bare repository; the ssh transport
// is stood in for by tests/helpers/fakeSshRemote.js.
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { simpleGit } = require("simple-git");
const { createFakeSshRemote } = require("./helpers/fakeSshRemote");
const environmentService = jest.requireActual("../src/services/environmentService");

jest.setTimeout(30000);

let root;
let remote;
let savedPath;

async function useRemote(options) {
  remote = await createFakeSshRemote(root, options);
  process.env.PATH = `${remote.binDir}${path.delimiter}${savedPath}`;
}

/** A ZIP whose entry names are exactly these, as a hostile generator could write them. */
function zipOf(files) {
  const zip = new AdmZip();
  Object.entries(files).forEach(([name, content], i) => {
    // addFile normalises the name; set it afterwards so the archive carries it raw.
    zip.addFile(`entry-${i}`, Buffer.from(content));
    zip.getEntry(`entry-${i}`).entryName = name;
  });
  return zip.toBuffer();
}

const push = (files, branch) =>
  environmentService.pushInfrastructure(zipOf(files), {
    url: remote.url,
    branch,
    sshKey: "not-a-real-key",
  });

const cloneArgs = () => remote.readGitInvocations().find((args) => args.includes("clone"));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "op262-"));
  savedPath = process.env.PATH;
});

afterEach(() => {
  process.env.PATH = savedPath;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("the customer repository is cloned shallow, one branch only", () => {
  it("clones only the tip of the configured branch when it exists", async () => {
    await useRemote();
    await push({ "terraform/aws/main.tf": "generated\n" }, "staging");

    expect(cloneArgs().join(" ")).toContain("--depth 1 --single-branch --branch staging");
    expect(await remote.fileOnBranch("staging", "terraform/aws/main.tf")).toBe("generated\n");
    expect(await remote.fileOnBranch("staging", "staging.txt")).toBe("staging only\n");
  });

  it("clones the default branch's tip when the configured branch does not exist yet", async () => {
    await useRemote();
    await push({ "terraform/aws/main.tf": "generated\n" }, "openprime-dev");

    expect(cloneArgs().join(" ")).toContain("--depth 1 --single-branch");
    expect(cloneArgs()).not.toContain("--branch");
    // Created off main and pushed on top of it, not as an orphan.
    expect(await remote.fileOnBranch("openprime-dev", "README.md")).toBe("customer file\n");
    expect(await remote.fileOnBranch("openprime-dev", "terraform/aws/main.tf")).toBe("generated\n");
  });

  it("still pushes to a repository with no commits yet", async () => {
    await useRemote({ empty: true });
    await push({ "terraform/aws/main.tf": "generated\n" }, "main");

    expect(await remote.fileOnBranch("main", "terraform/aws/main.tf")).toBe("generated\n");
  });
});

describe("git never runs repository-controlled hooks or fsmonitor", () => {
  it("disables both on every git command of a push", async () => {
    await useRemote();
    await push({ "terraform/aws/main.tf": "generated\n" }, "main");

    const invocations = remote.readGitInvocations();
    expect(invocations.length).toBeGreaterThan(0);
    for (const args of invocations) {
      expect(args.slice(0, 4)).toEqual([
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
      ]);
    }
  });
});

describe("a generated archive never reaches .git/", () => {
  it("refuses an archive that writes .git/config, before git acts on it", async () => {
    await useRemote();
    const marker = path.join(root, "fsmonitor-ran");
    const mainBefore = await simpleGit(remote.bare).revparse(["main"]);

    await expect(
      push(
        {
          "terraform/aws/main.tf": "generated\n",
          ".git/config": [
            "[core]",
            "\trepositoryformatversion = 0",
            "\tbare = false",
            `\tfsmonitor = "echo ran > '${marker}'; exit 1 #"`,
            '[remote "origin"]',
            `\turl = ${remote.url}`,
            "\tfetch = +refs/heads/*:refs/remotes/origin/*",
            "",
          ].join("\n"),
        },
        "main",
      ),
    ).rejects.toThrow(/\.git/);

    expect(fs.existsSync(marker)).toBe(false);
    expect(await simpleGit(remote.bare).revparse(["main"])).toBe(mainBefore);
  });

  it.each([
    ["nested/.git/config", "a nested repository"],
    ["x/../.git/config", "a .. that folds back into .git"],
    [".git\\config", "a backslash separator"],
    [".GIT/config", "another case"],
  ])("refuses %s (%s)", async (name) => {
    await useRemote();

    await expect(push({ [name]: "[core]\n", "main.tf": "generated\n" }, "main")).rejects.toThrow(
      /\.git/i,
    );
    expect(await remote.fileOnBranch("main", "main.tf")).toBeNull();
  });

  it("still accepts .github/, .gitignore and .gitlab-ci.yml", async () => {
    await useRemote();
    await push(
      {
        ".github/workflows/terraform.yml": "on: push\n",
        ".gitignore": ".terraform/\n",
        ".gitlab-ci.yml": "stages: []\n",
      },
      "main",
    );

    expect(await remote.fileOnBranch("main", ".github/workflows/terraform.yml")).toBe("on: push\n");
    expect(await remote.fileOnBranch("main", ".gitignore")).toBe(".terraform/\n");
    expect(await remote.fileOnBranch("main", ".gitlab-ci.yml")).toBe("stages: []\n");
  });
});
