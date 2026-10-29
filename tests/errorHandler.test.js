// tests/errorHandler.test.js
// The central handler is the last thing between an unexpected exception and the
// client. A 5xx must not carry the exception's own text (Sequelize SQL, AWS ARNs,
// file paths); a deliberate 4xx must keep its message, because that is how the
// user learns what to fix.
const { errorHandler } = require("../src/middleware/errorHandler");

function run(err) {
  const req = { requestId: "req-1", log: { error: jest.fn() } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  errorHandler(err, req, res, () => {});
  return { req, status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
}

describe("errorHandler", () => {
  it("does not send an unexpected error's message to the client", () => {
    const { status, body } = run(new Error('relation "users" does not exist'));

    expect(status).toBe(500);
    expect(body).toEqual({ error: "Internal Server Error", requestId: "req-1" });
  });

  it("still logs the real message server-side", () => {
    const { req } = run(new Error('relation "users" does not exist'));

    expect(req.log.error).toHaveBeenCalledWith(
      "Request error",
      expect.objectContaining({ error: 'relation "users" does not exist', statusCode: 500 }),
    );
  });

  it("hides the message of an explicit 5xx too", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 10.0.3.7:5432"), { status: 503 });

    expect(run(err)).toMatchObject({ status: 503, body: { error: "Internal Server Error" } });
  });

  it("keeps a 5xx message the code marked as safe to expose", () => {
    const err = Object.assign(new Error("Catalog is temporarily unavailable"), {
      status: 502,
      expose: true,
    });

    expect(run(err)).toMatchObject({
      status: 502,
      body: { error: "Catalog is temporarily unavailable" },
    });
  });

  it("keeps the message of a 4xx", () => {
    const err = Object.assign(new Error("Both access key and secret key are required"), {
      status: 400,
    });

    expect(run(err)).toMatchObject({
      status: 400,
      body: { error: "Both access key and secret key are required", requestId: "req-1" },
    });
  });

  // generationErrors.js and environmentService.js set statusCode, not status.
  it("honours an error that only sets statusCode", () => {
    const err = Object.assign(new Error("Generation refused: unknown service"), {
      statusCode: 422,
    });

    expect(run(err)).toMatchObject({
      status: 422,
      body: { error: "Generation refused: unknown service" },
    });
  });
});
