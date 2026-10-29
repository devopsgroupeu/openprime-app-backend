// tests/gitUrl.test.js
// The repository URL is user-supplied and reaches `git clone`. See OP-175.
//
// The audit listed four vectors; two were measured as already covered by the
// stack (git refuses the `ext` transport by default, simple-git blocks a leading
// '-'), so these tests focus on the one that was genuinely open: the scheme.
const { validateGitRepositoryUrl, checkRepositoryAddress } = require("../src/validators/gitUrl");

const ok = (url) => expect(validateGitRepositoryUrl(url)).toEqual({ valid: true });
const bad = (url) => {
  const result = validateGitRepositoryUrl(url);
  expect(result.valid).toBe(false);
  expect(typeof result.reason).toBe("string");
  return result.reason;
};

describe("validateGitRepositoryUrl — accepted forms", () => {
  it("accepts the scp-like form the wizard asks for", () => {
    // Matches the wizard placeholder: git@github.com:organization/repository.git
    ok("git@github.com:organization/repository.git");
    ok("git@gitlab.com:group/subgroup/repo.git");
  });

  it("accepts ssh:// including a non-default port", () => {
    // DevOpsGroup's own GitLab listens on 3522, which scp-like syntax cannot express.
    ok("ssh://git@gitlab.devopsgroup.sk:3522/internal/argocd/argocd-apps.git");
    ok("ssh://git@github.com/org/repo.git");
  });

  it("accepts https://", () => {
    ok("https://github.com/org/repo.git");
    ok("https://gitlab.example.com:8443/group/repo.git");
  });

  it("accepts a self-hosted host on a private network", () => {
    // Deliberately allowed: self-hosted git on an internal network is a
    // first-class use case, so private ranges are not blocked.
    ok("ssh://git@10.20.30.40/infra/repo.git");
    ok("git@192.168.1.10:infra/repo.git");
    ok("ssh://git@[fd12:3456::1]/infra/repo.git");
  });

  it("tolerates surrounding whitespace from a paste", () => {
    ok("  git@github.com:org/repo.git  ");
  });
});

describe("validateGitRepositoryUrl — rejected transports", () => {
  it("rejects file://, which clones happily by default", () => {
    // This was the one live gap: verified that `git clone file:///path` succeeds.
    expect(bad("file:///etc/passwd")).toMatch(/scheme/i);
    expect(bad("file://" + __dirname)).toMatch(/scheme/i);
  });

  it("rejects a bare local path", () => {
    bad("/tmp/some-repo");
    bad("./relative/repo");
    bad("../escape/repo");
  });

  it("rejects plaintext http", () => {
    expect(bad("http://github.com/org/repo.git")).toMatch(/scheme/i);
  });

  it("rejects git:// and other schemes", () => {
    bad("git://github.com/org/repo.git");
    bad("ftp://example.com/repo.git");
  });

  it("rejects transport helpers", () => {
    expect(bad("ext::sh -c whoami")).toMatch(/transport helper/i);
    expect(bad("transport::address")).toMatch(/transport helper/i);
  });

  it("rejects a leading dash", () => {
    expect(bad("--upload-pack=touch /tmp/x")).toMatch(/must not start with/i);
  });
});

describe("validateGitRepositoryUrl — rejected hosts", () => {
  it("rejects loopback", () => {
    bad("https://localhost/repo.git");
    bad("ssh://git@127.0.0.1/repo.git");
    bad("git@localhost:repo.git");
  });

  it("rejects cloud instance metadata", () => {
    expect(bad("https://169.254.169.254/latest/meta-data/")).toMatch(/not allowed/i);
    bad("ssh://git@169.254.169.254/repo.git");
  });

  // OP-262 (D27): address literals the exact-string list let through.
  it.each([
    ["git@127.0.0.2:org/repo.git", "the rest of 127.0.0.0/8"],
    ["ssh://git@[::ffff:127.0.0.1]/org/repo.git", "IPv4-mapped loopback"],
    ["ssh://git@[fd00:ec2::254]/org/repo.git", "the AWS IPv6 metadata endpoint"],
    ["ssh://git@[fe80::1]/org/repo.git", "IPv6 link-local"],
    ["git@0.1.2.3:org/repo.git", "0.0.0.0/8, which Linux connects to as this host"],
  ])("rejects %s (%s)", (url) => {
    expect(bad(url)).toMatch(/not allowed/i);
  });
});

describe("checkRepositoryAddress — where the host actually resolves (OP-262 D27)", () => {
  const dns = require("node:dns").promises;

  const resolvesTo = (...addresses) =>
    jest
      .spyOn(dns, "lookup")
      .mockResolvedValue(
        addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      );

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Real resolver: numeric forms need no network, and they are what git's own
  // getaddrinfo would read too.
  it.each([
    ["git@127.1:org/repo.git"],
    ["ssh://git@2130706433/org/repo.git"],
    ["git@0x7f.1:org/repo.git"],
  ])("rejects %s, which the resolver reads as loopback", async (url) => {
    expect(validateGitRepositoryUrl(url)).toEqual({ valid: true }); // the string check alone passes it
    const result = await checkRepositoryAddress(url);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/127\.0\.0\.1/);
  });

  it("rejects a name that resolves to instance metadata", async () => {
    resolvesTo("169.254.169.254");
    const result = await checkRepositoryAddress("git@metadata.google.internal:org/repo.git");
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/169\.254\.169\.254/);
  });

  it("rejects a name when any one of its addresses is blocked", async () => {
    resolvesTo("203.0.113.10", "::1");
    expect((await checkRepositoryAddress("https://mixed.example.com/org/repo.git")).valid).toBe(
      false,
    );
  });

  it("asks the resolver for the bare IPv6 address, without brackets", async () => {
    const lookup = resolvesTo("fd12:3456::1");
    await checkRepositoryAddress("ssh://git@[fd12:3456::1]/infra/repo.git");
    expect(lookup).toHaveBeenCalledWith("fd12:3456::1", expect.anything());
  });

  it("allows a self-hosted server on a private network", async () => {
    resolvesTo("10.20.30.40", "fd12:3456::1");
    expect(await checkRepositoryAddress("git@gitlab.internal:infra/repo.git")).toEqual({
      valid: true,
    });
  });

  it("leaves a name that does not resolve to git, which fails on it anyway", async () => {
    jest
      .spyOn(dns, "lookup")
      .mockRejectedValue(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }));
    expect(await checkRepositoryAddress("git@nowhere.example.test:org/repo.git")).toEqual({
      valid: true,
    });
  });
});

describe("validateGitRepositoryUrl — malformed input", () => {
  it.each([undefined, null, 42, {}, [], "", "   "])("rejects %p", (value) => {
    const result = validateGitRepositoryUrl(value);
    expect(result.valid).toBe(false);
  });

  it("rejects a host-only string that is not a URL", () => {
    bad("not a url at all");
  });
});
