const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
const { logger } = require("../utils/logger");

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

const client = jwksClient({
  jwksUri: `${keycloakConfig.serverUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/certs`,
  requestHeaders: {},
  timeout: 30000,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
  jwksRequestTimeout: 30000,
});

// Pure check: is this token's authorized-party (azp) or audience (aud) one of
// the clients we trust? An empty allow-list means validation is disabled and
// every client is accepted (returns true).
function isAllowedClient(decoded, allowedClients) {
  if (allowedClients.length === 0) return true;
  const aud = Array.isArray(decoded.aud) ? decoded.aud : decoded.aud ? [decoded.aud] : [];
  return allowedClients.includes(decoded.azp) || aud.some((a) => allowedClients.includes(a));
}

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      logger.error("Error getting signing key", { error: err.message, kid: header.kid });
      return callback(err);
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
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
    try {
      const decoded = jwt.decode(token);
      log.debug("JWT token claims", {
        aud: decoded?.aud,
        iss: decoded?.iss,
        sub: decoded?.sub,
        clientId: decoded?.azp || decoded?.client_id,
      });
    } catch (e) {
      log.debug("Failed to decode token for debugging", { error: e.message });
    }

    jwt.verify(
      token,
      getKey,
      {
        issuer: keycloakConfig.allowedIssuers,
        algorithms: ["RS256"],
      },
      (err, decoded) => {
        if (err) {
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
        next();
      },
    );
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
};
