// setup.js mocks the whole environmentService; test the real transform here.
process.env.INJECTO_SERVICE_URL = process.env.INJECTO_SERVICE_URL || "http://localhost:8000";
const environmentService = jest.requireActual("../src/services/environmentService");

describe("prepareInjectoData — scoped Terraform state keys", () => {
  const base = {
    name: "prod",
    provider: "aws",
    region: "eu-west-1",
    terraform_backend: { enabled: true, bucketName: "acct-terraform-prod" },
  };

  test("new environment scopes the state keys under its state_key prefix", () => {
    const data = environmentService.prepareInjectoData({
      ...base,
      state_key: "env/abc-123",
    });
    expect(data.terraformBackend.awsStateKey).toBe("env/abc-123/aws.tfstate");
    expect(data.terraformBackend.kubernetesStateKey).toBe("env/abc-123/kubernetes.tfstate");
  });

  test("legacy environment (null state_key) keeps the fixed keys", () => {
    const data = environmentService.prepareInjectoData({
      ...base,
      state_key: null,
    });
    expect(data.terraformBackend.awsStateKey).toBe("aws.tfstate");
    expect(data.terraformBackend.kubernetesStateKey).toBe("kubernetes.tfstate");
  });

  test("no terraform backend yields a null terraformBackend", () => {
    const data = environmentService.prepareInjectoData({
      name: "x",
      provider: "aws",
      region: "eu-west-1",
      terraform_backend: null,
      state_key: "env/xyz",
    });
    expect(data.terraformBackend).toBeNull();
  });
});
