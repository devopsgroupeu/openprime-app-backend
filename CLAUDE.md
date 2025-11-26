# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Essential Commands
```bash
npm run dev          # Start dev server with nodemon hot-reload (port 3001)
npm start            # Start production server
npm test             # Run Jest test suite
npm run test:db      # Test database connection only
npm run lint         # Run ESLint
npm run lint:fix     # Auto-fix ESLint issues
npm run format       # Format code with Prettier
npm run format:check # Check formatting without changes
```

### Running a Single Test
```bash
npm test -- --testPathPattern="environment"  # Run tests matching pattern
npm test -- tests/environment.test.js        # Run specific test file
```

### Docker Development
Development is typically done via the orchestration module at `../openprime-local-testing/`:
```bash
cd ../openprime-local-testing
npm start            # Start full stack (backend, postgres, keycloak)
npm run logs:backend # Watch backend logs
```

## Architecture Overview

### Core Stack
- **Framework**: Express.js 4.18.2 with standard MVC pattern
- **Database**: PostgreSQL with Sequelize ORM 6.35.2
- **Authentication**: Keycloak OIDC via JWT validation (JWKS-RSA)
- **External Processing**: StateCraft service for Terraform operations

### Application Structure
```
src/
├── server.js              # Express app, middleware stack, graceful shutdown
├── config/database.js     # Sequelize connection and initialization
├── routes/index.js        # Route aggregation
├── controllers/           # Request handlers
├── services/              # Business logic layer
├── models/                # Sequelize model definitions
├── middleware/            # Auth and error handling
├── validators/            # Joi validation schemas
└── utils/logger.js        # Winston logging
```

### Active API Routes
Current routes registered in `src/routes/index.js`:
- `/api/environments` - Infrastructure environment CRUD
- `/api/users` - User management (auto-created from Keycloak)
- `/api/ai` - AI assistant integration (AWS Bedrock)
- `/api/cloud-credentials` - Cloud provider credential management

### Data Model Relationships
```
User (1) ──> (N) Environment
User (1) ──> (N) CloudCredential
CloudCredential (1) ──> (N) Environment
```

**Key Model Fields:**
- `Environment.services`: JSONB for dynamic service configuration
- `Environment.terraform_backend`: JSONB for S3/DynamoDB backend config
- `Environment.git_repository`: JSONB for GitOps integration
- `CloudCredential.credentials`: AES-256-GCM encrypted credentials with getter/setter

### Middleware Stack (in order)
1. `helmet()` - Security headers
2. `cors()` - Single origin from `FRONTEND_URL`
3. `rateLimit` - 100 requests per 15 minutes on `/api/`
4. `compression()` - Response compression
5. Body parsers - 50MB limit for large configs
6. `requestLogger` - Request correlation ID and structured logging

### Authentication Flow
JWT tokens are validated using JWKS from Keycloak. The `authenticateToken` middleware:
1. Extracts Bearer token from Authorization header
2. Fetches signing keys from Keycloak JWKS endpoint
3. Verifies RS256 signature and issuer
4. Populates `req.user` with decoded claims

## Environment Variables

All variables are required and validated on startup (no defaults):

**Server:**
- `PORT` - Server port
- `FRONTEND_URL` - CORS allowed origin
- `LOG_LEVEL` - Winston log level (debug, info, warn, error)

**Database:**
- `DB_NAME` - PostgreSQL database name
- `DB_USER` - PostgreSQL username
- `DB_PASSWORD` - PostgreSQL password
- `DB_HOST` - PostgreSQL host
- `DB_PORT` - PostgreSQL port

**Authentication:**
- `KEYCLOAK_REALM` - Keycloak realm name
- `KEYCLOAK_URL` - Keycloak server URL

**External Services:**
- `STATECRAFT_SERVICE_URL` - StateCraft service URL
- `INJECTO_SERVICE_URL` - Injecto infrastructure generation service URL
- `CREDENTIALS_ENCRYPTION_KEY` - 32-byte hex key for credential encryption

**Optional:**
- `NODE_ENV` - Set to `development` for SQL logging and auto-sync
- `CONSOLE_LOGGING` - Set to `true` for console output in production
- `KEYCLOAK_JWT_ISSUERS` - Comma-separated list of allowed JWT issuers
- `INFRA_TEMPLATES_REPO_URL` - Git repo for infrastructure templates
- `INFRA_TEMPLATES_BRANCH` - Git branch for infrastructure templates

## Testing

Tests use Jest with mocked database and authentication:
- Test setup in `tests/setup.js` mocks Keycloak auth, database, and services
- `req.user` is automatically populated with test user in all tests
- Run with `npm test` - uses `--forceExit` to handle async cleanup

### Test User Mock
```javascript
{
  id: 'test-user-id',
  username: 'testuser',
  email: 'test@example.com',
  roles: ['user']
}
```

## Key Integration Points

### StateCraft Service
External Python service for Terraform backend resource management:
- `POST /resources/create` - Create S3 bucket and optional DynamoDB table
- `POST /resources/delete` - Remove backend resources
- `GET /health` - Health check

### AI Service
AWS Bedrock integration for chat assistance:
- Uses `@aws-sdk/client-bedrock-runtime`
- Model instructions in `src/utils/aiModelInstructions.js`

## Logging

### Architecture
- **Library**: Winston with JSON format
- **Transports**: File (`logs/error.log`, `logs/combined.log`) + conditional console
- **Request Correlation**: Each request gets a unique `requestId` via `X-Request-ID` header

### Usage Patterns

**In Controllers** - Use request-scoped logger:
```javascript
req.log.info('Environment created', { environmentId: env.id, userId: user.id });
req.log.error('Failed to create environment', { error: error.message });
```

**In Services** - Use global logger with structured context:
```javascript
const { logger } = require('../utils/logger');
logger.info('Environment created', { environmentId: env.id, userId: data.user_id });
```

### Log Levels
- `debug` - Verbose data, JWT claims, SQL queries (development only)
- `info` - Operations, state changes, API calls
- `warn` - Non-critical issues, validation failures, auth failures
- `error` - Exceptions, service failures

### Sensitive Data
- JWT claims logged at `debug` level only
- Never log credentials, tokens, or secrets
- Use structured objects, not string interpolation

## Code Style

- ESLint flat config (ESM) in `eslint.config.mjs`
- Unused vars allowed if prefixed with `_`
- `console` statements allowed
- Prettier formatting with lint-staged on commit
