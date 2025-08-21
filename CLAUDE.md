# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Essential Commands
- `npm run dev` - Start development server with nodemon hot-reload on port 3001
- `npm start` - Start production server 
- `npm test` - Run Jest test suite
- `npm run lint` - Run ESLint on src/ directory

### Docker Development
- `docker-compose up` - Start full stack (backend, postgres, redis)
- `docker build .` - Build backend container

## Architecture Overview

### Core Technology Stack
- **Backend**: Express.js REST API with middleware for security, logging, rate limiting
- **Python Integration**: Child process execution for infrastructure processing via PythonService
- **Database**: PostgreSQL (via docker-compose)
- **Cache**: Redis (via docker-compose)
- **Logging**: Winston with file and console transports

### Application Structure
The codebase follows a standard Express MVC pattern:

```
src/
├── server.js              # Express app setup, middleware, health check
├── routes/                # Route definitions (index.js aggregates all routes)
├── controllers/           # Request handlers for each domain
├── services/              # Business logic and external integrations
├── validators/            # Input validation (Joi-based)
├── middleware/            # Custom middleware (error handling)
└── utils/                 # Utilities (Winston logger)
```

### Key Architectural Patterns

**Python Service Integration**: The `PythonService` class (`src/services/pythonService.js`) orchestrates infrastructure operations by spawning Python processes. All Python scripts are located in the `python/` directory and communicate via JSON over stdin/stdout.

**Multi-Domain API**: Six main domains with dedicated route files:
- `/api/environments` - Infrastructure environment management
- `/api/helm` - Helm chart operations and validation  
- `/api/terraform` - Terraform generation and planning
- `/api/deployments` - Deployment tracking and rollback
- `/api/templates` - Configuration templates
- `/api/settings` - Application and cloud provider settings

**File Upload Handling**: Uses multer for file uploads with dedicated `uploads/helm/` directory for Helm charts.

**Security Middleware Stack**: Helmet, CORS, rate limiting (100 req/15min), and 50MB body limit for large configuration files.

## Environment Configuration

The application requires a `.env` file (copy from `.env.example`). Key environment variables:
- `PORT` - Server port (default: 3001)
- `PYTHON_PATH` - Path to Python executable (default: python3)
- `PYTHON_SCRIPTS_PATH` - Python scripts directory (default: ./python)
- `FRONTEND_URL` - CORS origin (default: http://localhost:3000)
- `LOG_LEVEL` - Winston log level (default: info)

## Testing

- Test files in `tests/` directory using Jest and Supertest
- Example test covers environment API endpoints with validation
- Health check endpoint available at `/health`

## Key Integration Points

**Python Scripts**: All infrastructure operations delegate to Python scripts via `PythonService.executePythonScript()`. Scripts include:
- Environment processing and deployment
- Helm chart validation and value generation  
- Terraform generation, validation, and planning
- Infrastructure-as-Code export

**Logging**: Winston logger configured in `src/utils/logger.js` with file logging to `logs/` directory and console output in development.