// tests/userPreferences.test.js
// PUT /api/users/me/preferences used to merge the whole request body into the
// stored JSONB, and the validators declared on the route were never checked.
// Only the known fields are stored now, and a bad value is a 400.
jest.mock("../src/services/userService", () => ({
  getUserByKeycloakId: jest.fn(),
  findOrCreateUser: jest.fn(),
  updateUserPreferences: jest.fn(),
}));

const request = require("supertest");
const app = require("../src/server");
const userService = require("../src/services/userService");

const put = (body) =>
  request(app)
    .put("/api/users/me/preferences")
    .set("Authorization", "Bearer test-token")
    .send(body);

describe("PUT /api/users/me/preferences", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    userService.getUserByKeycloakId.mockResolvedValue({ id: 1, username: "testuser" });
    userService.updateUserPreferences.mockImplementation((_id, prefs) =>
      Promise.resolve({ preferences: prefs }),
    );
  });

  // Exactly what the settings page sends (openprime-app SettingsPage.jsx).
  it("stores what the settings page sends", async () => {
    const body = {
      theme: "light",
      notifications: true,
      defaultProvider: "aws",
      defaultRegion: "eu-west-1",
      gitIntegration: { platform: "github", orgUrl: "" },
    };

    const res = await put(body);

    expect(res.status).toBe(200);
    expect(userService.updateUserPreferences).toHaveBeenCalledWith(1, body);
  });

  // The settings page's own option value, unlike every other provider list.
  it("accepts the settings page's on-premise spelling", async () => {
    const res = await put({ defaultProvider: "on-premise" });

    expect(res.status).toBe(200);
    expect(userService.updateUserPreferences).toHaveBeenCalledWith(1, {
      defaultProvider: "on-premise",
    });
  });

  it("drops fields that are not preferences", async () => {
    const res = await put({
      theme: "dark",
      isAdmin: true,
      roles: ["admin"],
      gitIntegration: { platform: "github", orgUrl: "", sshKey: "-----BEGIN KEY-----" },
    });

    expect(res.status).toBe(200);
    expect(userService.updateUserPreferences).toHaveBeenCalledWith(1, {
      theme: "dark",
      gitIntegration: { platform: "github", orgUrl: "" },
    });
  });

  it("leaves absent fields out so a partial update keeps the rest", async () => {
    await put({ defaultRegion: "us-east-1" });

    expect(userService.updateUserPreferences).toHaveBeenCalledWith(1, {
      defaultRegion: "us-east-1",
    });
  });

  it.each([
    ["theme", { theme: "blue" }],
    ["notifications", { notifications: "sometimes" }],
    ["defaultProvider", { defaultProvider: "digitalocean" }],
    ["defaultRegion", { defaultRegion: 42 }],
    ["gitIntegration.platform", { gitIntegration: { platform: 7 } }],
  ])("rejects an invalid %s with 400 and stores nothing", async (_field, body) => {
    const res = await put(body);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.any(Array));
    expect(userService.updateUserPreferences).not.toHaveBeenCalled();
  });
});
