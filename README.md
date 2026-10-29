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

The backend decides what reaches the model, whatever the client sends. Client `system` messages are dropped; only `user`/`assistant` turns are accepted, of which the last 20 are forwarded, each cut at 4,000 characters. The environment context is rebuilt from an allow-list (environment name, provider, region and the catalog-described settings of the enabled services) and sent as a delimited user turn: the repository URL and SSH key, cloud credential IDs, Helm values and free-form objects never leave the backend. `currentService`/`topic` must name a catalog service (400 otherwise). Each user gets `AI_CHAT_MAX_PER_MINUTE` (default 20) and `AI_CHAT_MAX_PER_DAY` (default 400) requests, counted per pod. A dropped connection cancels the Bedrock call.

### Health

- `GET /health` - Health check. On the server root, outside `/api` and outside the rate limiter

> **These endpoints used to be documented and have never existed:** everything under
> `/api/helm/*`, `/api/terraform/*`, `/api/deployments/*` and `/api/settings/*`, plus
> `POST /api/environments/:id/deploy`, `GET /api/environments/:id/status` and
> `GET /api/environments/:id/export`. `src/routes/` contains exactly `ai.js`,
> `catalog.js`, `cloudCredentials.js`, `environments.js`, `jobs.js` and `users.js`.
> Deploying is the customer's own generated pipeline's job, not this API's.

## Metrics

- `GET /metrics` - Prometheus metrics, on the **separate metrics port** (`METRICS_PORT`,
  default `9090`), never on the API port. The endpoint is unauthenticated, so it is kept off
  the port the public ingress routes to; Prometheus scrapes it in-cluster through the chart's
  ServiceMonitor. The API pods and the job worker both serve it. Set `METRICS_ENABLED=false`
  to not start the listener.
- Chart behaviour: the ServiceMonitor is only rendered on clusters that serve
  `monitoring.coreos.com/v1` (the Prometheus Operator CRDs); with `networkPolicy.enabled` the
  chart adds a rule letting `metrics.scrapeNamespaceSelector` (default `monitoring`) reach the
  metrics port; and if `service.type` is not `ClusterIP` the metrics port moves to a separate
  ClusterIP `-metrics` Service so it is never exposed outside the cluster.

| Metric                                                                                                     | What it measures                                                                       |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `http_requests_total`, `http_request_duration_seconds`                                                     | Requests by `method`, `route` (the matched pattern) and `status_code`; probes excluded |
| `openprime_jobs_total`, `openprime_job_duration_seconds`                                                   | Generate/push executions by `type` and `outcome` (`succeeded`, `retried`, `failed`)    |
| `openprime_jobs_in_flight`, `openprime_jobs_expired_total`                                                 | Jobs executing now; queued jobs the deadline sweep failed                              |
| `openprime_db_pool_connections`, `openprime_db_pool_max_connections`, `openprime_db_pool_pending_acquires` | Sequelize pool usage and saturation                                                    |
| `openprime_bedrock_requests_total`, `openprime_bedrock_request_duration_seconds`                           | Bedrock calls by `operation` and `outcome` (`success`, `throttled`, `error`)           |
| `openprime_bedrock_throttles_total`                                                                        | Every Bedrock `ThrottlingException`, including retried ones                            |

Default Node.js process metrics (CPU, memory, event loop lag, GC) are included. The HTTP metric
names and labels match Injecto and StateCraft, so one query works across all three services.

### Grafana dashboards

The chart ships three dashboards in `chart/dashboards/`, deployed as ConfigMaps that the Grafana
sidecar of kube-prometheus-stack loads by label (`grafanaDashboards.enabled`, on by default):

- **OpenPrime / Overview** - rate, 5xx ratio and p95 latency for the API, Injecto and
  StateCraft; users & activity (new and active users, environments created/updated/deleted,
  credentials added, generate/push requests), counted from the backend's logs in Loki;
  restarts, replicas and error logs
- **OpenPrime / Backend API** - per-route table, latency percentiles, DB pool saturation,
  Node.js runtime, HPA headroom and memory against limit
- **OpenPrime / Jobs & AI** - generate/push outcomes and durations, jobs in flight and expired,
  Bedrock calls, latency and throttles

Edit a dashboard in Grafana, export it as JSON and replace the file; the sidecar reloads it
without restarting Grafana. The queries rely on the `service`, `endpoint`, `pod` and `container`
labels the Prometheus Operator adds to scraped series, and on kube-state-metrics; on a managed
Prometheus that labels targets differently (e.g. GKE Managed Prometheus) they need adapting.

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
│   │   ├── errorHandler.js
│   │   └── httpMetrics.js     # RED metrics by route pattern
│   └── utils/                 # Utilities
│       ├── logger.js
│       └── metrics.js         # Prometheus registry + metrics-port listener
├── uploads/                   # File uploads directory
├── logs/                      # Application logs
├── tests/                     # Test files
├── package.json
├── .env.example
└── README.md
```

## License

Appache 2.0
