// src/services/catalogService.js
const axios = require("axios");
const { logger } = require("../utils/logger");
const { getRequestId } = require("../utils/requestContext");

// Fail at require time rather than on the first request. A backend that boots
// without this serves 502s that look like an Injecto outage.
if (!process.env.INJECTO_SERVICE_URL) {
  throw new Error("INJECTO_SERVICE_URL is not set — the catalog cannot be served without Injecto");
}

const REQUEST_TIMEOUT_MS = 30000;

// Read per call rather than at module load: a deployment can change the budget
// without a restart, and tests can vary it without re-requiring the module —
// which silently hands the re-required copy a different axios mock.
const ttlMs = () => parseInt(process.env.CATALOG_CACHE_TTL_MS || "300000", 10); // 5 min
const staleMaxMs = () => parseInt(process.env.CATALOG_STALE_MAX_MS || "86400000", 10); // 24 h

// Deliberately a module-level object rather than Redis or node-cache. The
// document is a few hundred KB, identical for every user, and cheap to refetch;
// a second process simply keeps its own copy. Injecto already caches by commit
// sha, so a miss here usually costs one ls-remote upstream, not a clone.
let cache = { doc: null, etag: null, fetchedAt: 0 };

function upstreamError(message, cause) {
  const err = new Error(message);
  err.status = 502;
  err.code = "catalog_unavailable";
  if (cause) err.cause = cause;
  return err;
}

async function fetchFromInjecto(etag) {
  const serviceToken = process.env.SERVICE_TOKEN;
  const requestId = getRequestId();

  return axios.get(`${process.env.INJECTO_SERVICE_URL}/catalog`, {
    // The same env pair generation sends, so the catalog the wizard renders
    // from and the templates the generate runs against cannot describe
    // different things.
    params: {
      repo_url: process.env.INFRA_TEMPLATES_REPO_URL,
      branch: process.env.INFRA_TEMPLATES_BRANCH,
    },
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      ...(serviceToken && { "X-Service-Token": serviceToken }),
      ...(requestId && { "X-Request-ID": requestId }),
      ...(etag && { "If-None-Match": etag }),
    },
    // 304 is a success for us; axios treats it as an error by default.
    validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
  });
}

async function getCatalog() {
  const now = Date.now();
  const age = now - cache.fetchedAt;

  if (cache.doc && age < ttlMs()) {
    return { doc: cache.doc, etag: cache.etag };
  }

  try {
    const response = await fetchFromInjecto(cache.etag);

    if (response.status === 304) {
      // Unchanged upstream: renew the TTL without replacing the document.
      cache.fetchedAt = now;
      logger.debug("Catalog unchanged upstream", { etag: cache.etag });
      return { doc: cache.doc, etag: cache.etag };
    }

    cache = {
      doc: response.data,
      etag: response.headers.etag || null,
      fetchedAt: now,
    };
    logger.info("Catalog refreshed", { etag: cache.etag, commit: response.data?.commit });
    return { doc: cache.doc, etag: cache.etag };
  } catch (error) {
    // Serving a slightly old catalog beats failing the wizard outright: the
    // document changes only when the templates repository does.
    if (cache.doc && age < staleMaxMs()) {
      logger.warn("Serving stale catalog — Injecto unreachable", {
        error: error.message,
        ageMs: age,
        staleMaxMs: staleMaxMs(),
      });
      return { doc: cache.doc, etag: cache.etag, stale: true };
    }

    logger.error("Catalog unavailable", { error: error.message, hasCache: Boolean(cache.doc) });
    throw upstreamError("Catalog is temporarily unavailable", error);
  }
}

// Test seam. Without it a cached document leaks between test cases and every
// assertion after the first one is really testing the cache.
function resetCache() {
  cache = { doc: null, etag: null, fetchedAt: 0 };
}

module.exports = { getCatalog, resetCache };
