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

describe("prepareInjectoData — git repository (OP-216)", () => {
  const withGit = (git_repository) =>
    environmentService.prepareInjectoData({
      name: "prod",
      provider: "aws",
      region: "eu-west-1",
      terraform_backend: null,
      git_repository,
    });

  test("sends the three fields templates consume", () => {
    // @param gitRepository.url and @param gitRepository.branch, in
    // terraform/kubernetes/terraform.auto.tfvars and argocd/applications.yaml;
    // @param gitRepository.branches in the generated workflow trigger.
    const data = withGit({ url: "git@github.com:acme/infra.git", branch: "release" });
    expect(data.gitRepository).toEqual({
      url: "git@github.com:acme/infra.git",
      branch: "release",
      branches: ["release"],
    });
  });

  test("branches is an array, because the workflow filter is a YAML sequence", () => {
    // REGRESSION (OP-235): the generated pipeline filters `on.push.branches`,
    // which GitHub requires to be a list. Injecto renders a JS array as JSON, so
    // only the array form substitutes into `branches: [...]`. A scalar here would
    // emit `branches: "release"` and change the meaning of the trigger.
    const data = withGit({ url: "git@github.com:acme/infra.git", branch: "release" });
    expect(Array.isArray(data.gitRepository.branches)).toBe(true);
    expect(data.gitRepository.branches).toHaveLength(1);
  });

  test("branches tracks the configured branch, not the repository default", () => {
    // The whole point of OP-235: a customer on a non-default branch used to get a
    // pipeline pinned to main that never fired for their pushes.
    const data = withGit({ url: "git@github.com:acme/infra.git", branch: "walk2-infra" });
    expect(data.gitRepository.branches).toEqual(["walk2-infra"]);
    expect(data.gitRepository.branches).not.toContain("main");
  });

  test("never sends the deploy key to Injecto", () => {
    // No template has ever read gitRepository.sshKey, yet the whole object used
    // to be forwarded — putting the customer's write-capable private key across
    // a service boundary on every single generate.
    const data = withGit({
      url: "git@github.com:acme/infra.git",
      branch: "main",
      sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET\n-----END OPENSSH PRIVATE KEY-----",
    });
    expect(data.gitRepository.sshKey).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("SECRET");
  });

  test("defaults the branch to HEAD, matching the argocd targetRevision", () => {
    const data = withGit({ url: "git@github.com:acme/infra.git" });
    expect(data.gitRepository.branch).toBe("HEAD");
    expect(data.gitRepository.branches).toEqual(["HEAD"]);
    expect(data.argocd.targetRevision).toBe("HEAD");
  });

  test("still populates argocd.git_repo_url from the same url", () => {
    const data = withGit({ url: "git@github.com:acme/infra.git", branch: "main" });
    expect(data.argocd.git_repo_url).toBe("git@github.com:acme/infra.git");
  });

  test("no git repository yields null", () => {
    expect(withGit(null).gitRepository).toBeNull();
  });
});
