// tests/globalPrefixValidation.test.js
//
// The backend's globalPrefix rule (OP-175) and the wizard's auto-suggest
// (openprime-app, "feat(wizard): auto-suggest global prefix from environment
// name") are coupled: the frontend derives the prefix from the name, and the
// backend then judges it. A bound tighter than what the frontend can produce
// rejects environments the UI happily offered to create.
//
// This test encodes that coupling so changing either side surfaces it here.
const { validateEnvironment } = require("../src/validators/environmentValidator");

// Mirrors openprime-app/src/components/modals/wizard/BasicConfigStep.jsx
const slugify = (value) => (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const derivePrefix = (name) => {
  const slug = slugify(name);
  return slug ? `${slug}-` : "";
};

const prefixValidator = validateEnvironment.find(
  (v) => v.builder?.fields?.[0] === "globalPrefix" || String(v).includes("globalPrefix"),
);

// express-validator chains expose their result through run(); build a minimal req.
const runValidators = async (body) => {
  const req = { body };
  for (const validator of validateEnvironment) {
    await validator.run(req);
  }
  const { validationResult } = require("express-validator");
  return validationResult(req);
};

const NAME_MAX = 50; // enforced by the name rule in the same validator

describe("globalPrefix accepts everything the wizard can auto-suggest", () => {
  it("has a globalPrefix rule at all", () => {
    expect(prefixValidator).toBeDefined();
  });

  it.each([
    ["demo", "demo-"],
    ["My Env 2", "myenv2-"],
    ["production-environment-for-the-eu-west-region", "productionenvironmentfortheeuwestregion-"],
    ["a".repeat(NAME_MAX), `${"a".repeat(NAME_MAX)}-`],
  ])("accepts the prefix derived from %p", async (name, expectedPrefix) => {
    expect(derivePrefix(name)).toBe(expectedPrefix);

    const result = await runValidators({
      name: name.slice(0, NAME_MAX),
      provider: "aws",
      globalPrefix: expectedPrefix,
    });
    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors).toEqual([]);
  });

  it("accepts an empty prefix, which an all-punctuation name produces", async () => {
    expect(derivePrefix("...")).toBe("");

    const result = await runValidators({
      name: "...",
      provider: "aws",
      globalPrefix: "",
    });
    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors).toEqual([]);
  });

  it("accepts an omitted prefix", async () => {
    const result = await runValidators({ name: "demo", provider: "aws" });
    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors).toEqual([]);
  });
});

describe("globalPrefix still rejects unsafe values", () => {
  it.each([
    ['bad"quote-', "quote"],
    ["with space-", "space"],
    ["-leading-hyphen", "leading hyphen"],
    ["$(whoami)-", "shell-ish"],
    [`${"a".repeat(70)}-`, "over the 63 ceiling"],
  ])("rejects %p (%s)", async (prefix) => {
    const result = await runValidators({
      name: "demo",
      provider: "aws",
      globalPrefix: prefix,
    });
    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors.length).toBeGreaterThan(0);
  });
});
