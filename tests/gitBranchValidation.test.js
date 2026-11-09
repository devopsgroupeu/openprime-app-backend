// tests/gitBranchValidation.test.js
// OP-271 (D85): the git branch reached `git checkout -B`, `git push`, the
// generated workflow trigger and the Argo CD targetRevision unvalidated.
// The rule is git's own (`git check-ref-format --branch`), not a narrower
// allow-list: any branch a push ever succeeded with stays valid, so no stored
// environment becomes uneditable (the OP-272 trap).
const { isValidBranchName } = require("../src/validators/gitBranch");
const { validateEnvironment } = require("../src/validators/environmentValidator");
const { validationResult } = require("express-validator");

const branchErrors = async (branch) => {
  const req = { body: { provider: "aws", gitRepository: { branch } }, params: {} };
  for (const validator of validateEnvironment) {
    await validator.run(req);
  }
  return validationResult(req)
    .array()
    .filter((e) => e.path === "gitRepository.branch");
};

describe("isValidBranchName follows git check-ref-format --branch", () => {
  it.each([
    "main",
    "develop",
    "feature/op-271",
    "release-1.2.3",
    "walk3-infra",
    "user/ändrej", // git accepts non-ASCII
    "fix_underscore",
    "a+b",
  ])("accepts %s", (name) => {
    expect(isValidBranchName(name)).toBe(true);
  });

  it.each([
    ["-starts-with-dash", "leading dash would read as an option"],
    ["a..b", ".."],
    ["a b", "space"],
    ["a~b", "~"],
    ["a^b", "^"],
    ["a:b", ":"],
    ["a?b", "?"],
    ["a*b", "*"],
    ["a[b", "["],
    ["a\\b", "backslash"],
    ["a\tb", "control character"],
    ["a\u007fb", "DEL"],
    ["/leading", "leading slash"],
    ["trailing/", "trailing slash"],
    ["a//b", "double slash"],
    ["ends.", "trailing dot"],
    [".hidden", "component starting with a dot"],
    ["a/.hidden", "component starting with a dot"],
    ["x.lock", "component ending in .lock"],
    ["a.lock/b", "component ending in .lock"],
    ["a@{b", "@{"],
    ["@", "single @"],
    ["HEAD", "HEAD is not a branch"],
    ["", "empty"],
    ["x".repeat(256), "longer than 255"],
  ])("rejects %j (%s)", (name) => {
    expect(isValidBranchName(name)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidBranchName(undefined)).toBe(false);
    expect(isValidBranchName(42)).toBe(false);
  });
});

describe("validateEnvironment checks gitRepository.branch", () => {
  it("rejects an invalid branch with a message", async () => {
    const errors = await branchErrors("-x");

    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toMatch(/branch/i);
  });

  it.each(["main", "feature/x"])("accepts %s", async (branch) => {
    expect(await branchErrors(branch)).toHaveLength(0);
  });

  it("leaves an empty branch to the default", async () => {
    expect(await branchErrors("")).toHaveLength(0);
  });
});
