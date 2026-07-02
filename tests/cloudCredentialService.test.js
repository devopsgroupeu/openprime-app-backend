// tests/cloudCredentialService.test.js
// Locks in that editing a credential never wipes the stored secret: since the
// API no longer returns decrypted secrets to the client, the edit form sends
// blank secret fields to mean "keep current", and updateCredential must only
// overwrite the secret when a new one is actually provided.
const cloudCredentialService = require("../src/services/cloudCredentialService");
const { CloudCredential } = require("../src/models");

describe("cloudCredentialService.updateCredential — secret preservation", () => {
  let stored;

  beforeEach(() => {
    stored = {
      id: "cred-1",
      provider: "aws",
      credentials: { accessKey: "OLD", secretKey: "OLDSECRET" },
      update: jest.fn().mockImplementation(function update(fields) {
        Object.assign(this, fields);
        return Promise.resolve(this);
      }),
    };
    CloudCredential.findOne = jest.fn().mockResolvedValue(stored);
    CloudCredential.update = jest.fn().mockResolvedValue([1]);
  });

  const fieldsFrom = (cred) => cred.update.mock.calls[0][0];

  it("preserves stored secrets when the update omits credentials", async () => {
    await cloudCredentialService.updateCredential("cred-1", "user-1", { name: "Renamed" });

    const fields = fieldsFrom(stored);
    expect(fields).toHaveProperty("name", "Renamed");
    expect(fields).not.toHaveProperty("credentials");
  });

  it("preserves stored secrets when credentials fields are blank", async () => {
    await cloudCredentialService.updateCredential("cred-1", "user-1", {
      name: "Renamed",
      credentials: { accessKey: "", secretKey: "" },
    });

    expect(fieldsFrom(stored)).not.toHaveProperty("credentials");
  });

  it("overwrites secrets when a new accessKey/secretKey is provided", async () => {
    await cloudCredentialService.updateCredential("cred-1", "user-1", {
      credentials: { accessKey: "NEW", secretKey: "NEWSECRET" },
    });

    expect(fieldsFrom(stored).credentials).toEqual({ accessKey: "NEW", secretKey: "NEWSECRET" });
  });

  it("throws when the credential does not belong to the user", async () => {
    CloudCredential.findOne = jest.fn().mockResolvedValue(null);

    await expect(
      cloudCredentialService.updateCredential("cred-1", "other-user", { name: "x" }),
    ).rejects.toThrow("Credential not found");
  });
});
