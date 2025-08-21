# OpenPrime Backend API

Backend service for OpenPrime Infrastructure Deployment Platform.

## Features

- RESTful API for infrastructure management
- YAML/JSON configuration processing
- Integration with Python processing service
- Helm chart management and validation
- Terraform generation and validation
- Multi-cloud support (AWS, Azure, GCP, On-premise)
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

### Environments
- `GET /api/environments` - Get all environments
- `GET /api/environments/:id` - Get specific environment
- `POST /api/environments` - Create new environment
- `PUT /api/environments/:id` - Update environment
- `DELETE /api/environments/:id` - Delete environment
- `POST /api/environments/:id/deploy` - Deploy environment
- `GET /api/environments/:id/status` - Get environment status
- `GET /api/environments/:id/export` - Export as IaC

### Helm Charts
- `GET /api/helm/charts` - Get available charts
- `GET /api/helm/charts/:chartName` - Get chart details
- `GET /api/helm/charts/:chartName/values` - Get default values
- `POST /api/helm/charts/:chartName/validate` - Validate values
- `POST /api/helm/generate-values` - Generate values from config

### Terraform
- `POST /api/terraform/generate` - Generate Terraform code
- `POST /api/terraform/validate` - Validate configuration
- `GET /api/terraform/modules` - Get available modules
- `POST /api/terraform/plan` - Plan Terraform changes
- `POST /api/terraform/export` - Export Terraform package

### Deployments
- `GET /api/deployments` - Get all deployments
- `GET /api/deployments/:id` - Get deployment details
- `POST /api/deployments` - Create deployment
- `GET /api/deployments/:id/logs` - Get deployment logs
- `POST /api/deployments/:id/rollback` - Rollback deployment

### Settings
- `GET /api/settings` - Get all settings
- `PUT /api/settings` - Update settings
- `GET /api/settings/cloud-providers` - Get cloud providers
- `POST /api/settings/api-keys` - Generate API key

## Project Structure

```
openprime-backend/
├── src/
│   ├── server.js              # Express server setup
│   ├── routes/                # API routes
│   │   ├── index.js
│   │   ├── environments.js
│   │   ├── helm.js
│   │   ├── terraform.js
│   │   ├── deployments.js
│   │   ├── templates.js
│   │   └── settings.js
│   ├── controllers/           # Route controllers
│   │   ├── environmentController.js
│   │   ├── helmController.js
│   │   ├── terraformController.js
│   │   ├── deploymentController.js
│   │   ├── templateController.js
│   │   └── settingsController.js
│   ├── services/              # Business logic
│   │   ├── pythonService.js
│   │   ├── environmentService.js
│   │   ├── helmService.js
│   │   ├── terraformService.js
│   │   ├── deploymentService.js
│   │   └── settingsService.js
│   ├── validators/            # Input validation
│   │   └── environmentValidator.js
│   ├── middleware/            # Custom middleware
│   │   └── errorHandler.js
│   └── utils/                 # Utilities
│       └── logger.js
├── python/                    # Python processing scripts
├── uploads/                   # File uploads directory
├── logs/                      # Application logs
├── tests/                     # Test files
├── package.json
├── .env.example
└── README.md
```

## License

Appache 2.0