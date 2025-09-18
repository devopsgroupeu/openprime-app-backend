const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { logger } = require('../utils/logger');

// Validate required environment variables
const requiredEnvVars = ['KEYCLOAK_REALM', 'KEYCLOAK_URL'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

const keycloakConfig = {
  realm: process.env.KEYCLOAK_REALM,
  serverUrl: process.env.KEYCLOAK_URL,
  // JWT issuer validation - can be single issuer or comma-separated list
  allowedIssuers: process.env.KEYCLOAK_JWT_ISSUERS ? 
    process.env.KEYCLOAK_JWT_ISSUERS.split(',').map(iss => iss.trim()) :
    [`${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`]
};

logger.info('Keycloak configuration:', keycloakConfig);
logger.info('JWKS URI:', `${keycloakConfig.serverUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/certs`);

const client = jwksClient({
  jwksUri: `${keycloakConfig.serverUrl}/realms/${keycloakConfig.realm}/protocol/openid-connect/certs`,
  requestHeaders: {},
  timeout: 30000,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
  jwksRequestTimeout: 30000,
  requestAgent: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? 
    require('https').Agent({ rejectUnauthorized: false }) : undefined
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      logger.error('Error getting signing key:', err);
      return callback(err);
    }
    const signingKey = key.publicKey || key.rsaPublicKey;
    callback(null, signingKey);
  });
}

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Debug: Log token payload without verification
    try {
      const decoded = jwt.decode(token);
      logger.info('JWT Token payload:', { 
        aud: decoded?.aud, 
        iss: decoded?.iss, 
        sub: decoded?.sub,
        client_id: decoded?.azp || decoded?.client_id
      });
      logger.info('Backend expects issuers:', keycloakConfig.allowedIssuers);
    } catch (e) {
      logger.error('Failed to decode token for debugging:', e.message);
    }

    jwt.verify(token, getKey, {
      // Skip audience validation for public client - Keycloak doesn't set audience for public clients
      issuer: keycloakConfig.allowedIssuers, // Use configurable issuers
      algorithms: ['RS256']
    }, (err, decoded) => {
      if (err) {
        logger.error('Token verification failed:', err);
        return res.status(403).json({ error: 'Invalid or expired token' });
      }

      req.user = {
        id: decoded.sub,
        username: decoded.preferred_username,
        email: decoded.email,
        firstName: decoded.given_name,
        lastName: decoded.family_name,
        fullName: decoded.name,
        roles: decoded.realm_access?.roles || [],
        resourceAccess: decoded.resource_access || {}
      };

      next();
    });
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

const requireRole = (role) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.user.roles.includes(role)) {
      return res.status(403).json({ error: `Role '${role}' required` });
    }

    next();
  };
};

module.exports = {
  authenticateToken,
  requireRole
};