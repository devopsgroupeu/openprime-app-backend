const { AsyncLocalStorage } = require("async_hooks");

// Per-request context, propagated automatically through the async call chain so
// any module (services, the logger) can read the current requestId without it
// being threaded through every function signature.
const requestContext = new AsyncLocalStorage();

function runWithRequestId(requestId, fn) {
  return requestContext.run({ requestId }, fn);
}

function getRequestId() {
  const store = requestContext.getStore();
  return store ? store.requestId : undefined;
}

module.exports = { requestContext, runWithRequestId, getRequestId };
