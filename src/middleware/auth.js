const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { logger } = require('../utils/logger');

const keycloakConfig = {
  realm: process.env.KEYCLOAK_REALM || 'openprime',
  serverUrl: process.env.KEYCLOAK_URL || 'http://localhost:8080',
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
      logger.info('Backend expects issuer:', `${keycloakConfig.serverUrl}/realms/${keycloakConfig.realm}`);
    } catch (e) {
      logger.error('Failed to decode token for debugging:', e.message);
    }

    jwt.verify(token, getKey, {
      audience: 'account', // Keycloak uses 'account' as default audience
      issuer: `${keycloakConfig.serverUrl}/realms/${keycloakConfig.realm}`, // Use actual Keycloak URL
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