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
  // The bound must not be stricter than what the wizard can produce. It
  // auto-suggests the prefix from the environment name by stripping everything
  // outside [a-z0-9] and appending '-', and names run to 50 characters — so a
  // long name yields a 51-character prefix. An all-punctuation name yields an
  // empty one, hence `values: "falsy"`. 63 is the ceiling most AWS resource
  // names allow, which is the real constraint here.
  body("globalPrefix")
    .optional({ values: "falsy" })
    .matches(/^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/)
    .withMessage("Global prefix must be alphanumeric with hyphens, max 63 characters"),

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

  body("services").optional().isObject().withMessage("Services must be an object"),

  body("services.vpc.enabled").optional().isBoolean().withMessage("VPC enabled must be a boolean"),

  body("services.vpc.cidr")
    .optional()
    .matches(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/)
    .withMessage("Invalid CIDR format"),

  body("services.eks.enabled").optional().isBoolean().withMessage("EKS enabled must be a boolean"),

  body("services.eks.version")
    .optional()
    .matches(/^\d+\.\d+$/)
    .withMessage("Invalid Kubernetes version format"),

  body("services.rds.enabled").optional().isBoolean().withMessage("RDS enabled must be a boolean"),

  body("services.rds.engine")
    .optional()
    .isIn(["postgres", "mysql", "mariadb", "aurora"])
    .withMessage("Invalid RDS engine"),
];
