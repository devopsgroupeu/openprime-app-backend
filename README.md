# OpenPrime Backend API

Backend service for OpenPrime Infrastructure Deployment Platform.

## Features

- RESTful API for infrastructure management
- YAML/JSON configuration processing
- Integration with Python processing service
- Helm chart management and validation
- Terraform generation and validation
- AWS infrastructure support (Azure, GCP and on-premise are on the roadmap)
- Security middleware (helmet, CORS, rate limiting)
- Comprehensive logging and error handling

## Prerequisites

- Node.js (v16 or higher)
- Python 3.8+ (for processing service)
- npm or yarn

## Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd openprime-backend
```

2. Install dependencies:

```bash
npm install
```

3. Copy environment variables:

```bash
cp .env.example .env
```

4. Configure environment variables in `.env`

5. Create logs directory:

```bash
mkdir logs
```

## Running the Application

### Development mode:

```bash
npm run dev
```

### Production mode:

```bash
npm start
```

### Run tests:

```bash
npm test
```

## API Endpoints

Everything below is mounted under `/api` and requires a Keycloak JWT, except
`GET /health`, which is served on the server root.

### Environments

- `GET /api/environments` - List the caller's environments
- `GET /api/environments/:id` - Get one environment
- `POST /api/environments` - Create an environment
- `PUT /api/environments/:id` - Update it. `name` and `globalPrefix` are immutable and a differing value is rejected with 400
- `DELETE /api/environments/:id` - Delete it
- `POST /api/environments/:id/generate` - Start a generation job
- `POST /api/environments/:id/push` - Push the generated repository to the customer's Git
- `POST /api/environments/terraform-backend/create` - Create the S3 state backend via StateCraft

### Jobs

Generation and push are asynchronous: `generate` returns a job, which is polled
and then downloaded.

- `GET /api/jobs/:jobId` - Job status: `queued`, `running`, `succeeded`, `failed`
- `GET /api/jobs/:jobId/download` - Download the generated archive

### Catalog

- `GET /api/catalog` - The service catalog, proxied from Injecto

The wizard is built from this document rather than from a hardcoded list. The
`ETag` is the templates commit, so a client holding the current catalog gets a
`304`; a `Warning: 110` header means it is being served from cache because Injecto
was unreachable.

### Cloud credentials

- `GET /api/cloud-credentials` - List credentials
- `POST /api/cloud-credentials` - Create one
- `GET /api/cloud-credentials/:credentialId` - Get one
- `PUT /api/cloud-credentials/:credentialId` - Update one
- `DELETE /api/cloud-credentials/:credentialId` - Delete one
- `PUT /api/cloud-credentials/:credentialId/default` - Mark as the account default

Secrets are AES-256-GCM encrypted at rest and redacted from every response.

### Users

- `GET /api/users/me` - Current user
- `PUT /api/users/me` - Update current user
- `GET /api/users/me/preferences` - Get preferences
- `PUT /api/users/me/preferences` - Update preferences
- `GET /api/users` - List all users (**admin only**)

### AI

- `POST /api/ai/chat` - Configuration assistance via AWS Bedrock

### Health

- `GET /health` - Health check. On the server root, outside `/api` and outside the rate limiter

> **These endpoints used to be documented and have never existed:** everything under
> `/api/helm/*`, `/api/terraform/*`, `/api/deployments/*` and `/api/settings/*`, plus
> `POST /api/environments/:id/deploy`, `GET /api/environments/:id/status` and
> `GET /api/environments/:id/export`. `src/routes/` contains exactly `ai.js`,
> `catalog.js`, `cloudCredentials.js`, `environments.js`, `jobs.js` and `users.js`.
> Deploying is the customer's own generated pipeline's job, not this API's.

## Project Structure

```
openprime-backend/
├── src/
│   ├── server.js              # Express server setup
│   ├── routes/                # API routes
│   │   ├── index.js
│   │   ├── ai.js
│   │   ├── catalog.js
│   │   ├── cloudCredentials.js
│   │   ├── environments.js
│   │   ├── jobs.js
│   │   └── users.js
│   ├── controllers/           # Route controllers
│   │   ├── aiController.js
│   │   ├── catalogController.js
│   │   ├── cloudCredentialController.js
│   │   ├── environmentController.js
│   │   ├── jobController.js
│   │   └── userController.js
│   ├── services/              # Business logic
│   │   ├── aiService.js
│   │   ├── catalogService.js       # caches the Injecto catalog
│   │   ├── cloudCredentialService.js
│   │   ├── environmentService.js   # prepareInjectoData() lives here
│   │   ├── jobProcessor.js
│   │   ├── jobService.js
│   │   ├── statecraftService.js
│   │   └── userService.js
│   ├── migrations/            # umzug migrations, applied by a PreSync job
│   ├── validators/            # Input validation
│   │   └── environmentValidator.js
│   ├── middleware/            # Custom middleware
│   │   └── errorHandler.js
│   └── utils/                 # Utilities
│       └── logger.js
├── uploads/                   # File uploads directory
├── logs/                      # Application logs
├── tests/                     # Test files
├── package.json
├── .env.example
└── README.md
```

## License

Appache 2.0
