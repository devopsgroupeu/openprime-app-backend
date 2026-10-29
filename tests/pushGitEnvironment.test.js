// tests/pushGitEnvironment.test.js
// OP-258 (D29): git, and every process git starts, used to inherit the
// backend's whole process.env - DB_PASSWORD, CREDENTIALS_ENCRYPTION_KEY, the
// platform AWS keys and SERVICE_TOKEN.
//
// This runs the real pushInfrastructure end to end. The repository URL is an
// ordinary scp-like ssh URL, and a stand-in `ssh` placed first on PATH plays
// the server: it records the environment git handed it, then serves the
// request from a local bare repository. What it records is what a real ssh
// (or anything else git spawns) would have seen.
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const simpleGit = require("simple-git");
const environmentService = jest.requireActual("../src/services/environmentService");

jest.setTimeout(30000);

// Values the backend holds in production that no push needs. DB_PASSWORD and
// CREDENTIALS_ENCRYPTION_KEY already come from tests/setup.js.
const SECRETS = {
  AWS_ACCESS_KEY_ID: "sentinel-aws-access-key-id",
  AWS_SECRET_ACCESS_KEY: "sentinel-aws-secret-access-key",
  AWS_SESSION_TOKEN: "sentinel-aws-session-token",
  SERVICE_TOKEN: "sentinel-service-token",
  SOME_OTHER_BACKEND_SETTING: "sentinel-other",
};

let root;
let envDump;
let savedEnv;

async function seedRemote() {
  const bare = path.join(root, "remotes", "org", "repo.git");
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
  return bare;
}

/** A stand-in ssh: record the environment, then run the remote command locally. */
function installFakeSsh() {
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  const script = [
    "#!/bin/sh",
    `env > "${envDump}"`,
    // The last argument is the remote command, e.g. git-upload-pack 'org/repo.git'.
    "for last; do :; done",
    `cd "${path.join(root, "remotes")}" && exec sh -c "git \${last#git-}"`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(bin, "ssh"), script, { mode: 0o755 });
  return bin;
}

function readEnvDump() {
  return Object.fromEntries(
    fs
      .readFileSync(envDump, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "op258-"));
  envDump = path.join(root, "ssh-env.txt");
  savedEnv = { ...process.env };
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("pushInfrastructure hands git an explicit environment", () => {
  it("pushes, and nothing from the backend's own environment reaches ssh", async () => {
    const bare = await seedRemote();
    const fakeSshDir = installFakeSsh();
    Object.assign(process.env, SECRETS);
    process.env.PATH = `${fakeSshDir}${path.delimiter}${process.env.PATH}`;

    const zip = new AdmZip();
    zip.addFile("terraform/aws/main.tf", Buffer.from("generated\n"));

    const result = await environmentService.pushInfrastructure(zip.toBuffer(), {
      url: "git@git.example.test:org/repo.git",
      branch: "main",
      sshKey: "not-a-real-key",
    });

    // The minimal environment is enough for a real clone, commit and push.
    expect(result.status).toBe("success");
    expect(await simpleGit(bare).show(["main:terraform/aws/main.tf"])).toBe("generated\n");

    const sshEnv = readEnvDump();
    for (const name of ["DB_PASSWORD", "CREDENTIALS_ENCRYPTION_KEY", ...Object.keys(SECRETS)]) {
      expect(sshEnv).not.toHaveProperty(name);
    }
    expect(Object.keys(sshEnv).filter((name) => name.startsWith("AWS_"))).toEqual([]);
    // By value too, in case something copies a secret under another name.
    const leaked = Object.entries(sshEnv).filter(
      ([, value]) =>
        value.includes("sentinel-") ||
        value === process.env.DB_PASSWORD ||
        value === process.env.CREDENTIALS_ENCRYPTION_KEY,
    );
    expect(leaked).toEqual([]);
  });
});
