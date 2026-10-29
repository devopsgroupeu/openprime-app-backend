// tests/aiChatLimit.test.js
// Per-user budget on POST /api/ai/chat (OP-263). Every request costs Bedrock
// tokens, so the limit is per user, not per IP: colleagues behind one NAT do
// not share it, and one user cannot spend another's.
process.env.AI_CHAT_MAX_PER_MINUTE = "2";

const request = require("supertest");

const mockSend = jest.fn();
jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  ConverseStreamCommand: jest.fn(),
  ConverseCommand: jest.fn(),
}));

// Overrides the global auth mock from tests/setup.js: the user comes from a
// header so one test can act as two people.
jest.mock("../src/middleware/auth", () => ({
  authenticateToken: (req, res, next) => {
    req.user = { id: req.headers["x-test-user"] || "test-user-id", roles: ["user"] };
    next();
  },
  requireRole: () => (req, res, next) => next(),
}));

const app = require("../src/server");

async function* streamOf(text) {
  yield { contentBlockDelta: { delta: { text } } };
}

const ask = (user) =>
  request(app)
    .post("/api/ai/chat")
    .set("X-Test-User", user)
    .send({ messages: [{ type: "user", content: "hi" }] });

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockImplementation(() => Promise.resolve({ stream: streamOf("hello") }));
});

it("limits each user separately and never calls Bedrock over the limit", async () => {
  expect((await ask("alice")).status).toBe(200);
  expect((await ask("alice")).status).toBe(200);

  const limited = await ask("alice");
  expect(limited.status).toBe(429);
  expect(limited.body.error).toMatch(/AI assistant/);

  expect((await ask("bob")).status).toBe(200);
  expect(mockSend).toHaveBeenCalledTimes(3);
});
