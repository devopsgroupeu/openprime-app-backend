// src/middleware/signingKeys.js
// Keycloak's token-signing keys, held in memory (OP-262, D80).
//
// jwks-rsa's per-kid cache sits in front of a shared fetch budget: a token
// with a made-up `kid` missed the cache and spent that budget, so once the
// real key's cache entry expired, legitimate requests failed with 401 and the
// frontend logged its users out. Here the whole key set is fetched at once and
// kept, so a known kid never needs the network. An unknown kid can trigger at
// most one fetch per UNKNOWN_KID_COOLDOWN_MS; that is how a key Keycloak
// rotated in is picked up on first sight. The set is also refetched every
// REFRESH_INTERVAL_MS, so a key Keycloak removed stops being accepted.
const jwksClient = require("jwks-rsa");
const { logger } = require("../utils/logger");

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const UNKNOWN_KID_COOLDOWN_MS = 30 * 1000;

class SigningKeysUnavailableError extends Error {
  constructor() {
    super("Signing keys are unavailable");
    this.status = 503;
  }
}

function createSigningKeyStore(jwksUri) {
  // No cache or rate limit here: this store is the cache.
  const client = jwksClient({ jwksUri, cache: false, rateLimit: false, timeout: 10000 });

  let keys = new Map();
  let loadedAt = 0; // last successful fetch
  let attemptedAt = 0; // last fetch, successful or not
  let lastFetchFailed = false;
  let inFlight = null;

  // Never rejects: a failed fetch keeps the keys we already have.
  function refresh() {
    if (!inFlight) {
      attemptedAt = Date.now();
      inFlight = client
        .getSigningKeys()
        .then((signingKeys) => {
          keys = new Map(signingKeys.map((key) => [key.kid, key.getPublicKey()]));
          loadedAt = Date.now();
          lastFetchFailed = false;
        })
        .catch((err) => {
          lastFetchFailed = true;
          logger.error("Fetching signing keys failed", { error: err.message, jwksUri });
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  }

  const coolingDown = () => Date.now() - attemptedAt < UNKNOWN_KID_COOLDOWN_MS;

  /**
   * The public key for `kid`, or null when the key set does not have it.
   * Throws SigningKeysUnavailableError when the key set could not be fetched:
   * then the token may well be valid, and the answer is 503, not 401.
   */
  async function getKey(kid) {
    if (inFlight) await inFlight;

    if (keys.has(kid)) {
      if (Date.now() - loadedAt > REFRESH_INTERVAL_MS && !coolingDown()) refresh();
      return keys.get(kid);
    }

    if (!coolingDown()) await refresh();
    if (keys.has(kid)) return keys.get(kid);
    if (lastFetchFailed) throw new SigningKeysUnavailableError();
    return null;
  }

  return { getKey, prefetch: refresh };
}

module.exports = { createSigningKeyStore, SigningKeysUnavailableError };
