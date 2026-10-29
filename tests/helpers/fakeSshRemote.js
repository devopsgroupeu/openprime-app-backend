// tests/helpers/fakeSshRemote.js
// Runs the real pushInfrastructure against a local bare repository.
//
// pushInfrastructure only takes ssh/https URLs: the validator and
// GIT_ALLOW_PROTOCOL refuse file:// and local paths. So the test uses an
// ordinary scp-like URL and puts two stand-ins first on PATH:
//   ssh - records the environment git handed it, then serves the request
//         (git-upload-pack / git-receive-pack) from <root>/remotes locally
//   git - records its arguments, then runs the real git
// What they record is what a real ssh, or git itself, would have received.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { simpleGit } = require("simple-git");

const REAL_GIT = execFileSync("sh", ["-c", "command -v git"]).toString().trim();
const ARG_SEPARATOR = "\u001f";

/**
 * Seed <root>/remotes/org/repo.git and install the stand-ins in <root>/bin.
 * Put `binDir` first on PATH only after this returns, so seeding is not logged.
 *
 * @param {string} root  an empty temp dir owned by the test
 * @param {{ empty?: boolean }} options  empty: a repository with no commits
 */
async function createFakeSshRemote(root, { empty = false } = {}) {
  const bare = path.join(root, "remotes", "org", "repo.git");
  await simpleGit().init(["--bare", "--initial-branch=main", bare]);

  if (!empty) {
    // `main` holds a customer file; `staging` has one more commit on top.
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
    fs.writeFileSync(path.join(seed, "staging.txt"), "staging only\n");
    await g.add(".");
    await g.commit("staging");
    await g.push(["-u", "origin", "staging"]);
  }

  const binDir = path.join(root, "bin");
  const sshEnvFile = path.join(root, "ssh-env.txt");
  const gitArgsFile = path.join(root, "git-args.txt");
  fs.mkdirSync(binDir);
  fs.writeFileSync(
    path.join(binDir, "ssh"),
    [
      "#!/bin/sh",
      `env > "${sshEnvFile}"`,
      // The last argument is the remote command, e.g. git-upload-pack 'org/repo.git'.
      "for last; do :; done",
      `cd "${path.join(root, "remotes")}" && exec sh -c "'${REAL_GIT}' \${last#git-}"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(binDir, "git"),
    [
      "#!/bin/sh",
      `printf '%s${ARG_SEPARATOR}' "$@" >> "${gitArgsFile}"`,
      `printf '\\n' >> "${gitArgsFile}"`,
      `exec "${REAL_GIT}" "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );

  return {
    url: "git@git.example.test:org/repo.git",
    bare,
    binDir,
    /** The environment ssh was started with, as { NAME: value }. */
    readSshEnv() {
      return Object.fromEntries(
        fs
          .readFileSync(sshEnvFile, "utf8")
          .split("\n")
          .filter((line) => line.includes("="))
          .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
      );
    },
    /** Every git invocation since binDir went on PATH, as arrays of arguments. */
    readGitInvocations() {
      if (!fs.existsSync(gitArgsFile)) return [];
      return fs
        .readFileSync(gitArgsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split(ARG_SEPARATOR).slice(0, -1));
    },
    /** A file's content on a branch of the remote, or null. */
    async fileOnBranch(branch, file) {
      try {
        return await simpleGit(bare).show([`${branch}:${file}`]);
      } catch {
        return null;
      }
    },
  };
}

module.exports = { createFakeSshRemote };
