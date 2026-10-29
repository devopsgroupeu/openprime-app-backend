// tests/pushGitEnvironment.test.js
// OP-258 (D29): git, and every process git starts, used to inherit the
// backend's whole process.env - DB_PASSWORD, CREDENTIALS_ENCRYPTION_KEY, the
// platform AWS keys and SERVICE_TOKEN.
//
// Runs the real pushInfrastructure end to end through a stand-in ssh that
// records the environment git handed it (tests/helpers/fakeSshRemote.js).
// What it records is what a real ssh, or anything else git spawns, would see.
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const AdmZip = require("adm-zip");
const { createFakeSshRemote } = require("./helpers/fakeSshRemote");
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
let savedEnv;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "op258-"));
  savedEnv = { ...process.env };
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("pushInfrastructure hands git an explicit environment", () => {
  it("pushes, and nothing from the backend's own environment reaches ssh", async () => {
    const remote = await createFakeSshRemote(root);
    Object.assign(process.env, SECRETS);
    process.env.PATH = `${remote.binDir}${path.delimiter}${process.env.PATH}`;

    const zip = new AdmZip();
    zip.addFile("terraform/aws/main.tf", Buffer.from("generated\n"));

    const result = await environmentService.pushInfrastructure(zip.toBuffer(), {
      url: remote.url,
      branch: "main",
      sshKey: "not-a-real-key",
    });

    // The minimal environment is enough for a real clone, commit and push.
    expect(result.status).toBe("success");
    expect(await remote.fileOnBranch("main", "terraform/aws/main.tf")).toBe("generated\n");

    const sshEnv = remote.readSshEnv();
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

    // What the push does set still arrives: simple-git 4 filters the GIT_*
    // variables it hands git and passes only those the push allows (OP-191).
    expect(sshEnv).toMatchObject({ GIT_ALLOW_PROTOCOL: "https:ssh", GIT_TERMINAL_PROMPT: "0" });
    expect(sshEnv.GIT_SSH_COMMAND).toMatch(/^ssh -i \S+ -o StrictHostKeyChecking=accept-new /);
  });
});
