// tests/pushBranch.test.js
// OP-181(1): push landed on the clone's default branch while the configured
// branch was used only as the ArgoCD targetRevision — "pushed successfully"
// plus a cluster watching a branch that never received the commit.
//
// These run against a real bare repository rather than a mocked simple-git,
// because the whole defect lives in git's behaviour, not in our control flow.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const simpleGit = require("simple-git");

jest.setTimeout(30000);

let root;
let bare;

/** A bare repo with one commit on `main`, plus an existing `staging` branch. */
async function seedRemote() {
  bare = path.join(root, "remote.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);

  const seed = path.join(root, "seed");
  fs.mkdirSync(seed);
  const g = simpleGit(seed);
  await g.init(["--initial-branch=main"]);
  await g.addConfig("user.email", "seed@test");
  await g.addConfig("user.name", "seed");
  fs.writeFileSync(path.join(seed, "README.md"), "customer file\n");
  await g.add(".");
  await g.commit("initial");
  await g.addRemote("origin", bare);
  await g.push(["-u", "origin", "main"]);
  await g.checkoutLocalBranch("staging");
  await g.push(["-u", "origin", "staging"]);
}

/**
 * The exact sequence pushInfrastructure performs, against a real clone.
 * Kept in step with environmentService.pushInfrastructure deliberately: the
 * point is to hold git's actual behaviour, which a mock cannot.
 */
async function pushGenerated(targetBranch, files) {
  const work = fs.mkdtempSync(path.join(root, "work-"));
  const git = simpleGit();
  await git.clone(bare, work);
  await git.cwd(work);

  if (targetBranch && targetBranch !== "HEAD") {
    const remotes = await git.branch(["-r"]);
    if (remotes.all.includes(`origin/${targetBranch}`)) {
      await git.checkout(targetBranch);
    } else {
      await git.checkoutLocalBranch(targetBranch);
    }
  }

  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(work, name)), { recursive: true });
    fs.writeFileSync(path.join(work, name), content);
  }

  await git.addConfig("user.email", "generated_by@openprime.com");
  await git.addConfig("user.name", "OpenPrime");
  await git.add(".");
  const status = await git.status();
  if (status.isClean()) return { pushed: false, overwritten: [] };

  const overwritten = [...status.modified].sort();
  await git.commit("Generated infrastructure with OpenPrime");
  await git.push(targetBranch && targetBranch !== "HEAD" ? ["-u", "origin", targetBranch] : []);
  return { pushed: true, overwritten, work };
}

/** Read a file from a branch of the bare repo — i.e. what the customer's CI sees. */
async function fileOnBranch(branch, file) {
  try {
    return await simpleGit(bare).show([`${branch}:${file}`]);
  } catch {
    return null;
  }
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "op181-"));
  await seedRemote();
});

afterEach(() => {
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
