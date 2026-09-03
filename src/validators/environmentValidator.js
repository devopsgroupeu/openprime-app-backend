// src/validators/environmentValidator.js
const { body } = require("express-validator");
const { validateGitRepositoryUrl } = require("./gitUrl");

// Characters that are dangerous once a value is interpolated into generated HCL
// or a shell-adjacent context. `name` is deliberately a targeted denylist rather
// than a positive allow-list: this validator runs on PUT as well as POST, and a
// stricter rule would reject an unchanged pre-existing name on every update.
const HCL_UNSAFE = /["'`$\\\r\n]/;

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
  // machine-shaped. Immutable after creation (see updateEnvironmentByUser).
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
  // length constraint. `values: "falsy"` covers an empty auto-suggested
  // prefix (e.g. an environment name that's all digits).
  body("globalPrefix")
    .optional({ values: "falsy" })
    .matches(/^[a-z](-?[a-z0-9]+)*-?$/)
    .withMessage(
      "Global prefix must start with a lowercase letter, contain only lowercase letters, digits and hyphens, and must not contain consecutive hyphens",
    )
    .isLength({ max: 63 })
    .withMessage("Global prefix must be at most 63 characters"),

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

  body("services").optional().isObject().withMessage("Services must be an object"),

  // No per-service field rules here on purpose. Which services exist and what
  // values they accept is the catalog's business (GET /api/catalog), extracted
  // from the templates themselves — duplicating it here means the wizard can
  // offer a value the API then rejects. The rds.engine whitelist did exactly
  // that, and services.eks.version guarded a key no payload has ever carried.
];
