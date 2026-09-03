// tests/fixtures/catalogDoc.js
//
// A realistic catalog document — the shape Injecto's extractor serves via
// GET /api/catalog and catalogService.getCatalog() returns as `doc`.
// Field metadata mirrors the real extractor output: min/max arrive as
// STRINGS, dropdown options can carry NUMBER values, and every field has
// name/path/tfVar/type/valueType metadata.
//
// Covers every services payload the API tests send, plus the fields the
// interim static schema wrongly rejected (eks.networkPolicyEnabled, the
// nine addon/AMI knobs, and the lambda service).

function field(name, type, valueType, extra = {}) {
  return {
    name,
    path: name,
    tfVar: name,
    displayName: name,
    description: `${name} field`,
    type,
    valueType,
    ...extra,
  };
}

const catalogDoc = {
  schemaVersion: 1,
  provider: "aws",
  commit: "fixture-commit-sha",
  global: {
    fields: {
      region: field("region", "dropdown", "string", {
        options: [
          { value: "eu-central-1", label: "eu-central-1" },
          { value: "us-east-1", label: "us-east-1" },
        ],
      }),
    },
  },
  services: {
    vpc: {
      key: "vpc",
      displayName: "VPC",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        cidr: field("cidr", "text", "string", {
          defaultValue: "10.0.0.0/16",
          validation: { pattern: "^(\\d{1,3}\\.){3}\\d{1,3}\\/\\d{1,2}$" },
        }),
        azCount: field("azCount", "dropdown", "number", {
          defaultValue: 2,
          options: [
            { value: 1, label: "1" },
            { value: 2, label: "2" },
            { value: 3, label: "3" },
          ],
        }),
        createPublicSubnets: field("createPublicSubnets", "toggle", "boolean", {
          defaultValue: true,
        }),
        natGateway: field("natGateway", "dropdown", "string", {
          defaultValue: "SINGLE",
          options: [
            { value: "NO_NAT", label: "No NAT" },
            { value: "SINGLE", label: "Single" },
            { value: "ONE_PER_AZ", label: "One per AZ" },
          ],
        }),
        publicSubnetTags: field("publicSubnetTags", "object", "object", { defaultValue: {} }),
      },
    },
    eks: {
      key: "eks",
      displayName: "EKS",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        kubernetesVersion: field("kubernetesVersion", "dropdown", "string", {
          defaultValue: "1.34",
          options: [
            { value: "1.34", label: "1.34" },
            { value: "1.35", label: "1.35" },
            { value: "1.36", label: "1.36" },
          ],
        }),
        networkPolicyEnabled: field("networkPolicyEnabled", "toggle", "boolean", {
          defaultValue: true,
        }),
        defaultNodeGroupMinSize: field("defaultNodeGroupMinSize", "number", "number", {
          defaultValue: 1,
          min: "0",
          max: "100",
        }),
        defaultNodeGroupMaxSize: field("defaultNodeGroupMaxSize", "number", "number", {
          defaultValue: 3,
          min: "1",
          max: "100",
        }),
        defaultNodeGroupUseLatestAmi: field("defaultNodeGroupUseLatestAmi", "toggle", "boolean", {
          defaultValue: false,
        }),
        addonCorednsMostRecent: field("addonCorednsMostRecent", "toggle", "boolean", {
          defaultValue: true,
        }),
        addonPodIdentityMostRecent: field("addonPodIdentityMostRecent", "toggle", "boolean", {
          defaultValue: true,
        }),
        addonPodIdentityBeforeCompute: field("addonPodIdentityBeforeCompute", "toggle", "boolean", {
          defaultValue: true,
        }),
        addonKubeProxyMostRecent: field("addonKubeProxyMostRecent", "toggle", "boolean", {
          defaultValue: true,
        }),
        addonVpcCniMostRecent: field("addonVpcCniMostRecent", "toggle", "boolean", {
          defaultValue: true,
        }),
        addonVpcCniBeforeCompute: field("addonVpcCniBeforeCompute", "toggle", "boolean", {
          defaultValue: true,
        }),
        addonEbsCsiMostRecent: field("addonEbsCsiMostRecent", "toggle", "boolean", {
          defaultValue: true,
        }),
        addonEfsCsiMostRecent: field("addonEfsCsiMostRecent", "toggle", "boolean", {
          defaultValue: true,
        }),
      },
    },
    rds: {
      key: "rds",
      displayName: "RDS",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        engine: field("engine", "dropdown", "string", {
          defaultValue: "postgres",
          options: [
            { value: "postgres", label: "PostgreSQL" },
            { value: "mysql", label: "MySQL" },
            { value: "aurora-postgresql", label: "Aurora PostgreSQL" },
          ],
        }),
        version: field("version", "text", "string", { defaultValue: "15.4" }),
        allocatedStorage: field("allocatedStorage", "number", "number", {
          defaultValue: 20,
          min: "20",
          max: "1000",
        }),
      },
    },
    aurora: {
      key: "aurora",
      displayName: "Aurora",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        engine: field("engine", "dropdown", "string", {
          defaultValue: "aurora-postgresql",
          options: [
            { value: "aurora-postgresql", label: "Aurora PostgreSQL" },
            { value: "aurora-mysql", label: "Aurora MySQL" },
          ],
        }),
        engineVersion: field("engineVersion", "text", "string", { defaultValue: "16.2" }),
      },
    },
    msk: {
      key: "msk",
      displayName: "MSK",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        kafkaVersion: field("kafkaVersion", "dropdown", "string", {
          defaultValue: "3.7.x",
          options: [
            { value: "3.9.x", label: "3.9.x" },
            { value: "3.8.x", label: "3.8.x" },
            { value: "3.7.x", label: "3.7.x" },
          ],
        }),
        numberOfBrokerNodes: field("numberOfBrokerNodes", "number", "number", {
          defaultValue: 3,
          min: "2",
          max: "30",
        }),
      },
    },
    sns: {
      key: "sns",
      displayName: "SNS",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        topicNames: field("topicNames", "array", "list", { defaultValue: [] }),
        enableEncryption: field("enableEncryption", "toggle", "boolean", { defaultValue: false }),
        kmsKeyId: field("kmsKeyId", "text", "string", { defaultValue: null }),
      },
    },
    cloudfront: {
      key: "cloudfront",
      displayName: "CloudFront",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        distributionNames: field("distributionNames", "array", "list", { defaultValue: [] }),
        enableLogging: field("enableLogging", "toggle", "boolean", { defaultValue: false }),
        loggingBucket: field("loggingBucket", "text", "string", { defaultValue: null }),
      },
    },
    s3: {
      key: "s3",
      displayName: "S3",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        bucketNames: field("bucketNames", "array", "list", { defaultValue: [] }),
      },
    },
    lambda: {
      key: "lambda",
      displayName: "Lambda",
      fields: {
        enabled: field("enabled", "toggle", "boolean", { defaultValue: false }),
        functionNames: field("functionNames", "array", "list", { defaultValue: [] }),
      },
    },
  },
};

module.exports = catalogDoc;
