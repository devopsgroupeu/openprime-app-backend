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

// Mirrors openprime-app/src/components/modals/wizard/BasicConfigStep.jsx.
// The leading-digit strip exists because RDS/Aurora identifiers and
// ElastiCache replication group ids require a letter first (OP-231) -
// stricter than the name field's own [a-z0-9] rule.
const slugify = (value) => (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const derivePrefix = (name) => {
  const slug = slugify(name).replace(/^[0-9]+/, "");
  return slug ? `${slug}-` : "";
};

const prefixValidator = validateEnvironment.find(
  (v) => v.builder?.fields?.[0] === "globalPrefix" || String(v).includes("globalPrefix"),
);

// express-validator chains expose their result through run(); build a minimal
// req. params/user simulate a PUT /:id request (authenticateToken has
// already set req.user by the time validateEnvironment runs); omitted, this
// simulates POST / (create).
const runValidators = async (body, { params, user } = {}) => {
  const req = { body, params: params || {}, user };
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
    // A name starting with a digit must not derive a digit-leading prefix -
    // RDS/Aurora identifiers and ElastiCache replication group ids reject
    // one at apply.
    ["2024-prod", "prod-"],
    ["123", ""],
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
    // RDS/Aurora identifiers and ElastiCache replication group ids reject
    // a leading digit and two consecutive hyphens at apply - OP-231.
    ["1app-", "leading digit"],
    ["app--test-", "double hyphen"],
    ["app_test-", "underscore"],
    // openprime-infra-templates/_variables.tf requires the trailing hyphen
    // too (elasticache.tf's naming relies on it as its own separator) - this
    // must reject on create, not merely fail terraform validate later.
    ["app", "no trailing hyphen"],
  ])("rejects %p (%s)", async (prefix) => {
    const result = await runValidators({
      name: "demo",
      provider: "aws",
      globalPrefix: prefix,
    });
    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors.length).toBeGreaterThan(0);
  });

  // The naive ^[a-z](-?[a-z0-9]+)*-?$ nests a `+` inside a `*`: measured
  // against POST /api/environments, a 32-character run of valid characters
  // with nothing at the end to match held the process for ~4.1s and doubled
  // every 2 characters - hours at the 63-character bound this rule allows,
  // and Node is single-threaded, so one request stalls everyone. The
  // replacement regex is exhaustively equivalent (299,592 strings up to
  // length 6 checked, 0 disagreements) but linear.
  it("rejects a pathological run of valid characters without catastrophic backtracking", async () => {
    const pathological = `${"a".repeat(30)}!`; // trailing "!" forces a full failed match

    const start = Date.now();
    const result = await runValidators({
      name: "demo",
      provider: "aws",
      globalPrefix: pathological,
    });
    const elapsedMs = Date.now() - start;

    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(500);
  }, 3000);
});

describe("globalPrefix on update: an existing value keeps its own shape", () => {
  // OP-231 tightened the charset. Without this, every future update to an
  // environment saved under the looser pre-OP-231 rule (uppercase, a
  // leading digit, a double hyphen - all legal before) would 400 here on
  // this field alone, even for an update that doesn't touch globalPrefix at
  // all: the wizard posts the whole environment back, and this validator
  // runs before updateEnvironmentByUser's own "unchanged is fine, changed is
  // rejected" immutability check ever gets a chance to run.
  const { Environment } = require("../src/models");
  let findOneSpy;

  beforeEach(() => {
    findOneSpy = jest.spyOn(Environment, "findOne").mockResolvedValue(null);
  });

  afterEach(() => {
    findOneSpy.mockRestore();
  });

  it("accepts an unchanged prefix that predates the tightened charset", async () => {
    findOneSpy.mockResolvedValue({ global_prefix: "1App--legacy-" });

    const result = await runValidators(
      { name: "demo", provider: "aws", globalPrefix: "1App--legacy-" },
      { params: { id: "env-1" }, user: { id: "user-1" } },
    );

    expect(findOneSpy).toHaveBeenCalledWith({
      where: { id: "env-1", user_id: "user-1" },
      attributes: ["global_prefix"],
    });
    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors).toEqual([]);
  });

  it("still rejects a genuinely new value that doesn't match the current charset", async () => {
    findOneSpy.mockResolvedValue({ global_prefix: "op-" });

    const result = await runValidators(
      { name: "demo", provider: "aws", globalPrefix: "1app-" },
      { params: { id: "env-1" }, user: { id: "user-1" } },
    );

    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors.length).toBeGreaterThan(0);
  });

  it("still validates normally on create (no params.id to look up)", async () => {
    const result = await runValidators(
      { name: "demo", provider: "aws", globalPrefix: "1app-" },
      { user: { id: "user-1" } },
    );

    expect(findOneSpy).not.toHaveBeenCalled();
    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors.length).toBeGreaterThan(0);
  });

  // Performance: the regex is checked first, so a PUT that already matches
  // the current charset - every environment created after OP-231, not just
  // ones untouched by this update - never pays for the DB round trip at all.
  it("skips the DB lookup entirely when the submitted value already matches the current charset", async () => {
    const result = await runValidators(
      { name: "demo", provider: "aws", globalPrefix: "op-" },
      { params: { id: "env-1" }, user: { id: "user-1" } },
    );

    expect(findOneSpy).not.toHaveBeenCalled();
    const prefixErrors = result.array().filter((e) => e.path === "globalPrefix");
    expect(prefixErrors).toEqual([]);
  });
});
