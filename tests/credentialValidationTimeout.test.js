// tests/credentialValidationTimeout.test.js
// Behavioural counterpart to the mocked-SDK suite in credentialValidation.test.js:
// that suite can only assert the config object passed to STSClient — nothing on
// the other side of the mock ever reads it, so it passes whether or not the
// timeout actually aborts. This test drives the real @aws-sdk/client-sts
// against a local TCP listener that accepts the connection and never writes a
// byte, and asserts the call aborts at the configured requestTimeout instead of
// hanging for as long as the socket lives.
const net = require("net");

const { validateAwsCredentials } = require("../src/services/credentialValidationService");

describe("credentialValidationService STS timeout (real SDK, stalling socket)", () => {
  let server;
  let sockets;
  let originalEndpoint;

  beforeAll((done) => {
    sockets = new Set();
    server = net.createServer((socket) => {
      // Accept the connection and stall: never respond, never close.
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      // SDK v3 honours AWS_ENDPOINT_URL_<SERVICE_ID>; point STS at the stall.
      originalEndpoint = process.env.AWS_ENDPOINT_URL_STS;
      process.env.AWS_ENDPOINT_URL_STS = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    if (originalEndpoint === undefined) {
      delete process.env.AWS_ENDPOINT_URL_STS;
    } else {
      process.env.AWS_ENDPOINT_URL_STS = originalEndpoint;
    }
    // The SDK's connection pool may keep the stalled socket alive; destroy it
    // so server.close() can finish.
    for (const socket of sockets) {
      socket.destroy();
    }
    server.close(() => done());
  }, 10000);

  it("aborts a stalled STS endpoint instead of hanging on the socket", async () => {
    const start = Date.now();
    const result = await validateAwsCredentials("AKIAEXAMPLE", "secret");
    const elapsed = Date.now() - start;

    expect(result.valid).toBe(false);
    // maxAttempts: 2 x requestTimeout: 5000ms ≈ 10s worst case. The pre-fix
    // behaviour (requestTimeout without throwOnRequestTimeout) only logged a
    // warning and kept the socket open well past 15s.
    expect(elapsed).toBeLessThan(12000);
  }, 20000);
});
