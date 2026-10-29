// tests/requestLogger.test.js
// X-Request-ID comes from the client. It is echoed in the response, written into
// every log record of the request and forwarded to Injecto/StateCraft, so only an
// id that looks like one is adopted; anything else gets a fresh id.
jest.unmock("../src/middleware/requestLogger");

const { requestLogger } = require("../src/middleware/requestLogger");
const { generateRequestId } = require("../src/utils/logger");

function run(headerValue) {
  const req = {
    headers: headerValue === undefined ? {} : { "x-request-id": headerValue },
    method: "GET",
    path: "/api/x",
    query: {},
  };
  const res = { setHeader: jest.fn(), on: jest.fn() };
  requestLogger(req, res, () => {});
  return { requestId: req.requestId, echoed: res.setHeader.mock.calls[0] };
}

describe("requestLogger X-Request-ID", () => {
  beforeEach(() => {
    generateRequestId.mockReturnValue("0123456789abcdef");
  });

  it.each([
    ["abc-123"],
    ["0123456789abcdef"],
    ["A".repeat(64)],
    ["550e8400-e29b-41d4-a716-446655440000"],
  ])("adopts the well-formed id %p", (id) => {
    expect(run(id)).toEqual({ requestId: id, echoed: ["X-Request-ID", id] });
  });

  it.each([
    ["too long", "A".repeat(65)],
    ["empty", ""],
    ["spaces", "abc def"],
    ["log-forging payload", 'x" level="error" msg="admin login'],
    ["path characters", "../../etc/passwd"],
    ["non-ASCII", "ïd"],
  ])("replaces a malformed id (%s) with a generated one", (_label, id) => {
    expect(run(id)).toEqual({
      requestId: "0123456789abcdef",
      echoed: ["X-Request-ID", "0123456789abcdef"],
    });
  });

  it("generates an id when the header is absent", () => {
    expect(run(undefined).requestId).toBe("0123456789abcdef");
  });
});
