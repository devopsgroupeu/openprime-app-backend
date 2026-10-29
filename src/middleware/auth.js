const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { logger } = require("../utils/logger");
const userService = require("../services/userService");
const { createSigningKeyStore, SigningKeysUnavailableError } = require("./signingKeys");

// Validate required environment variables
const requiredEnvVars = ["KEYCLOAK_REALM", "KEYCLOAK_URL"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const keycloakConfig = {
  realm: process.env.KEYCLOAK_REALM,
  serverUrl: process.env.KEYCLOAK_URL,
  // JWT issuer validation - can be single issuer or comma-separated list
  allowedIssuers: process.env.KEYCLOAK_JWT_ISSUERS
    ? process.env.KEYCLOAK_JWT_ISSUERS.split(",").map((iss) => iss.trim())
    : [`${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`],
  // Restrict which OIDC clients the API trusts. Keycloak sets `azp` to the
  // client that obtained the token, so we can reject tokens minted for other
  // clients in the realm without needing a realm audience mapper.
  allowedClients: (process.env.KEYCLOAK_ALLOWED_CLIENTS || process.env.KEYCLOAK_CLIENT_ID || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean),
};

if (keycloakConfig.allowedClients.length === 0) {
  logger.warn(
    "Audience validation disabled: set KEYCLOAK_CLIENT_ID (or KEYCLOAK_ALLOWED_CLIENTS) to restrict which OIDC clients the API accepts",
  );
}

logger.debug("Keycloak configuration", { config: keycloakConfig });
logger.debug("JWKS URI", {
  uri: `${keycloakConfig.serverUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/certs`,
});

const signingKeys = createSigningKeyStore(
  `${keycloakConfig.serverUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/certs`,
);

// Deactivating a user (userService.deactivateUser sets is_active=false) has to
// cut off the API, not only the UI. The lookup is cached per user for
// ACTIVE_CACHE_MS, so a deactivated user keeps access for at most that long on
// each pod. A user without a row yet is let through: the row is created on
// first login (GET /api/users/me).
const ACTIVE_CACHE_MS = 30 * 1000;
const ACTIVE_CACHE_MAX_ENTRIES = 10000;
const activeCache = new Map();

async function isDeactivated(keycloakId) {
  const cached = activeCache.get(keycloakId);
  if (cached && cached.expiresAt > Date.now()) return cached.deactivated;

  const user = await userService.getUserByKeycloakId(keycloakId);
  const deactivated = user?.is_active === false;
  if (activeCache.size >= ACTIVE_CACHE_MAX_ENTRIES) activeCache.clear();
  activeCache.set(keycloakId, { deactivated, expiresAt: Date.now() + ACTIVE_CACHE_MS });
  return deactivated;
}

// Every authenticated route passes through authenticateToken, so this is where
// the per-user budget is enforced (OP-262, D34): colleagues behind one NAT no
// longer share a budget, and more IPs buy an account nothing. The per-IP limit
// in server.js stays in front as a flood guard for unauthenticated traffic.
// Job polling is exempt here as it is there; it has its own limiter
// (src/routes/jobs.js). The store is in memory, so the budget is per pod.
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => req.user.id,
  skip: (req) => req.baseUrl === "/api/jobs",
  message: { error: "Too many requests, please try again later." },
});

// Pure check: is this token's authorized-party (azp) or audience (aud) one of
// the clients we trust? An empty allow-list means validation is disabled and
// every client is accepted (returns true).
function isAllowedClient(decoded, allowedClients) {
  if (allowedClients.length === 0) return true;
  const aud = Array.isArray(decoded.aud) ? decoded.aud : decoded.aud ? [decoded.aud] : [];
  return allowedClients.includes(decoded.azp) || aud.some((a) => allowedClients.includes(a));
}

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    // Debug: Log token claims (sensitive - debug level only)
    const log = req.log || logger;
    const unverified = jwt.decode(token, { complete: true });
    log.debug("JWT token claims", {
      aud: unverified?.payload?.aud,
      iss: unverified?.payload?.iss,
      sub: unverified?.payload?.sub,
      clientId: unverified?.payload?.azp || unverified?.payload?.client_id,
    });

    let signingKey = null;
    try {
      const kid = unverified?.header?.kid;
      if (kid) signingKey = await signingKeys.getKey(kid);
    } catch (err) {
      if (!(err instanceof SigningKeysUnavailableError)) throw err;
      // Not the token's fault: answering 401 would log the user out.
      return res.status(503).json({ error: "Authentication is temporarily unavailable" });
    }
    if (!signingKey) {
      log.warn("Token verification failed", {
        error: "unknown signing key",
        kid: unverified?.header?.kid,
      });
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, signingKey, {
        issuer: keycloakConfig.allowedIssuers,
        algorithms: ["RS256"],
      });
    } catch (err) {
      log.warn("Token verification failed", { error: err.message });
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Reject tokens minted for other clients in the realm. Signature/issuer
    // alone accept any token the realm signs; azp/aud pins it to our client.
    if (!isAllowedClient(decoded, keycloakConfig.allowedClients)) {
      log.warn("Token rejected: azp/aud not in allowed clients", {
        azp: decoded.azp,
        aud: decoded.aud,
      });
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    let deactivated;
    try {
      deactivated = await isDeactivated(decoded.sub);
    } catch (err) {
      log.error("User status lookup failed", { error: err.message });
      return res.status(503).json({ error: "Authentication is temporarily unavailable" });
    }
    if (deactivated) {
      log.warn("Token rejected: user is deactivated", { userId: decoded.sub });
      return res.status(403).json({ error: "User account is deactivated" });
    }

    req.user = {
      id: decoded.sub,
      username: decoded.preferred_username,
      email: decoded.email,
      firstName: decoded.given_name,
      lastName: decoded.family_name,
      fullName: decoded.name,
      roles: decoded.realm_access?.roles || [],
      resourceAccess: decoded.resource_access || {},
    };

    log.debug("User authenticated", { userId: req.user.id, username: req.user.username });
    userLimiter(req, res, next);
  } catch (error) {
    const log = req.log || logger;
    log.error("Authentication middleware error", { error: error.message, stack: error.stack });
    return res.status(500).json({ error: "Authentication error" });
  }
};

const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!req.user.roles.includes(role)) {
      return res.status(403).json({ error: `Role '${role}' required` });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  requireRole,
  isAllowedClient,
  prefetchSigningKeys: signingKeys.prefetch,
};
