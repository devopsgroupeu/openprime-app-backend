// src/validators/environmentValidator.js
const { body } = require("express-validator");
const { validateGitRepositoryUrl } = require("./gitUrl");
const { Environment } = require("../models");
const { validateServices } = require("./serviceSchema");

// Characters that are dangerous once a value is interpolated into generated HCL
// or a shell-adjacent context. `name` is deliberately a targeted denylist rather
// than a positive allow-list: this validator runs on PUT as well as POST, and a
// stricter rule would reject an unchanged pre-existing name on every update.
const HCL_UNSAFE = /["'`$\\\r\n]/;

// Linear rewrite of the naive ^[a-z](-?[a-z0-9]+)*-?$, which nested a `+`
// inside a `*` and catastrophically backtracked on a run of valid characters
// with no match at the end: a 32-character input held the process for ~4.1s,
// doubling every 2 characters - hours at the 63-character bound this rule
// allows. This form is linear: the same class of input takes under a
// millisecond regardless of length.
//
// The trailing "-" is mandatory, not optional (the naive form's `-?$` was
// too loose): openprime-infra-templates/_variables.tf requires it too -
// elasticache.tf's replication_group_id/subnet_group_name/parameter_group_name
// rely on global_prefix supplying that dash as their separator, and add none
// of their own. Making it optional here would let a value pass this
// validator, get persisted, and only fail later at `terraform validate` -
// exactly the "accepted here should never be rejectable there" gap this
// ticket exists to close. The wizard's sanitizer (BasicConfigStep.jsx)
// already always appends it, so this doesn't reject anything the UI
// produces; it only closes the gap for a direct API caller that bypasses
// the wizard.
const GLOBAL_PREFIX_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*-$/;

exports.validateEnvironment = [
  body("name")
    .notEmpty()
    .withMessage("Environment name is required")
    .isLength({ min: 2, max: 50 })
    .withMessage("Name must be between 2 and 50 characters")
    .custom((value) => {
      if (HCL_UNSAFE.test(value)) {
        throw new Error("Name must not contain quotes, backslashes, $ or newlines");
      }
      return true;
    }),

  // Baked into every generated Terraform resource name, so it has to be
  // machine-shaped. Immutable after creation (see updateEnvironmentByUser) -
  // but that check runs *after* this validator, on the controller side, so a
  // stored value that predates a charset tightening (uppercase, a leading
  // digit, a double hyphen - all legal under the pre-OP-231 rule) would
  // otherwise 400 here on every future update to that environment, even ones
  // that don't touch globalPrefix at all, since the wizard posts the whole
  // object back. The custom validator below skips the charset check when the
  // submitted value is exactly what's already stored, leaving
  // updateEnvironmentByUser's immutability check as the one place that
  // rejects an actual attempted change.
  //
  // The canonical charset here is the strictest of the AWS resource types
  // global_prefix feeds (see openprime-infra-templates/templates/terraform/
  // aws/{s3,database,elasticache}.tf): RDS/Aurora identifiers and ElastiCache
  // replication group ids both require a lowercase-letter-first name and
  // reject two consecutive hyphens, which S3 bucket names allow but these
  // don't. The wizard (BasicConfigStep.jsx) sanitizes to the same shape as it
  // types, so an accepted value here should never have been rejectable there.
  //
  // 63 is the ceiling most AWS resource names allow, which is the real
  // length constraint. It's checked - and bailed on - before the regex runs:
  // GLOBAL_PREFIX_RE is linear, but there's no reason to run it at all
  // against an input this route was never meant to accept. `values: "falsy"`
  // covers an empty auto-suggested prefix (e.g. an environment name that's
  // all digits).
  body("globalPrefix")
    .optional({ values: "falsy" })
    .isLength({ max: 63 })
    .withMessage("Global prefix must be at most 63 characters")
    .bail()
    .custom(async (value, { req }) => {
      // Regex first: cheap, linear, and true for every value the wizard can
      // produce and every environment created after this charset tightened -
      // the common case on both POST and PUT. Only a genuinely grandfathered
      // value (saved under a looser pre-OP-231 rule) needs the DB round trip
      // below, and only on PUT.
      if (GLOBAL_PREFIX_RE.test(value)) {
        return true;
      }
      if (req.params?.id && req.user?.id) {
        const existing = await Environment.findOne({
          where: { id: req.params.id, user_id: req.user.id },
          attributes: ["global_prefix"],
        });
        if (existing && existing.global_prefix === value) {
          return true;
        }
      }
      throw new Error(
        "Global prefix must start with a lowercase letter, contain only lowercase letters, digits and hyphens, must not contain consecutive hyphens, and must end in a hyphen",
      );
    }),

  body("gitRepository.url")
    .optional({ values: "falsy" })
    .custom((value) => {
      const { valid, reason } = validateGitRepositoryUrl(value);
      if (!valid) {
        throw new Error(reason);
      }
      return true;
    }),

  body("provider")
    .notEmpty()
    .withMessage("Environment provider is required")
    .isIn(["aws", "azure", "gcp", "onpremise"])
    .withMessage("Invalid environment provider"),

  body("region")
    .optional()
    .matches(/^[a-z0-9-]+$/)
    .withMessage("Region must contain only lowercase letters, digits and hyphens"),

  // Substituted into generated ingress hosts, external-dns domainFilters and
  // Terraform strings, so it is a positive allow-list rather than a denylist:
  // DNS labels only, at least two of them, alphabetic TLD, 253 characters max.
  // `values: "falsy"` because an empty domain is the documented way to ship no
  // host-based ingresses, and the field is editable after creation.
  body("domain")
    .optional({ values: "falsy" })
    .matches(/^(?=.{1,253}$)([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/)
    .withMessage("Domain must be a hostname such as example.com"),

  body("services")
    .optional()
    .isObject()
    .withMessage("Services must be an object")
    .custom(async (services, { req }) => {
      const provider = req.body.provider;
      const { valid, errors } = await validateServices(services, { provider });
      if (!valid) {
        throw new Error(errors.join("; "));
      }
      return true;
    }),

  // Per-service structural validation (known service keys, known field keys,
  // field types, number bounds) runs via validateServices above, which
  // derives its schema from the same runtime catalog document the wizard
  // renders from (getServiceSchema() → catalogService.getCatalog()). The API
  // therefore cannot reject a value the wizard offers. Dropdown option
  // values and text validation patterns remain the catalog's business — the
  // backend does not duplicate them. If the catalog is unreachable,
  // per-service checks are skipped rather than rejecting payloads we cannot
  // verify; Injecto still validates every value at generation time.
];
