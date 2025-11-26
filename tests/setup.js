// tests/setup.js
// Set all required environment variables BEFORE any modules are loaded
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.LOG_LEVEL = 'error';
process.env.DB_NAME = 'openprime_test';
process.env.DB_USER = 'postgres';
process.env.DB_PASSWORD = 'postgres';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.KEYCLOAK_REALM = 'test-realm';
process.env.KEYCLOAK_URL = 'http://localhost:8080';
process.env.STATECRAFT_SERVICE_URL = 'http://localhost:8000';
process.env.INJECTO_SERVICE_URL = 'http://localhost:8000';
process.env.CREDENTIALS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Mock Keycloak authentication for tests
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    // Mock user for tests
    req.user = {
      id: 'test-user-id',
      username: 'testuser',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
      fullName: 'Test User',
      roles: ['user'],
      resourceAccess: {}
    };
    next();
  },
  requireRole: (role) => (req, res, next) => {
    if (!req.user || !req.user.roles.includes(role)) {
      return res.status(403).json({ error: `Role '${role}' required` });
    }
    next();
  }
}));

// Mock database for tests
jest.mock('../src/config/database', () => ({
  sequelize: {
    authenticate: jest.fn().mockResolvedValue(true),
    sync: jest.fn().mockResolvedValue(true),
    close: jest.fn().mockResolvedValue(true),
    define: jest.fn().mockImplementation(() => {
      const model = class MockModel {};
      model.findAll = jest.fn().mockResolvedValue([]);
      model.findOne = jest.fn().mockResolvedValue(null);
      model.create = jest.fn().mockImplementation((data) => Promise.resolve({ id: 1, ...data }));
      model.update = jest.fn().mockResolvedValue([1]);
      model.destroy = jest.fn().mockResolvedValue(1);
      model.hasMany = jest.fn().mockReturnValue(model);
      model.belongsTo = jest.fn().mockReturnValue(model);
      model.hasOne = jest.fn().mockReturnValue(model);
      model.belongsToMany = jest.fn().mockReturnValue(model);
      return model;
    })
  },
  testConnection: jest.fn().mockResolvedValue(true),
  initializeDatabase: jest.fn().mockResolvedValue(true),
  closeConnection: jest.fn().mockResolvedValue(true)
}));

// Mock services
jest.mock('../src/services/userService', () => ({
  getUserByKeycloakId: jest.fn().mockResolvedValue({ id: 1, username: 'testuser' }),
  findOrCreateUser: jest.fn().mockResolvedValue({ id: 1, username: 'testuser' })
}));

jest.mock('../src/services/environmentService', () => ({
  createEnvironment: jest.fn().mockImplementation((data) => 
    Promise.resolve({ id: 1, ...data, created_at: new Date(), updated_at: new Date() })
  ),
  getUserEnvironments: jest.fn().mockResolvedValue([]),
  getEnvironmentByIdAndUser: jest.fn().mockResolvedValue(null),
  updateEnvironmentByUser: jest.fn().mockResolvedValue(null),
  deleteEnvironmentByUser: jest.fn().mockResolvedValue(true),
  convertToYAML: jest.fn().mockResolvedValue('test: yaml')
}));

// Mock logger to reduce noise
jest.mock('../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    stream: { write: jest.fn() },
    child: jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    })
  },
  generateRequestId: jest.fn().mockReturnValue('test-request-id'),
  createRequestLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

// Mock request logger middleware
jest.mock('../src/middleware/requestLogger', () => ({
  requestLogger: (req, res, next) => {
    req.requestId = 'test-request-id';
    req.log = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };
    next();
  }
}));

// Mock statecraft service
jest.mock('../src/services/statecraftService', () => ({
  createBackendResources: jest.fn().mockResolvedValue({ success: true, data: {} }),
  deleteBackendResources: jest.fn().mockResolvedValue({ success: true, data: {} }),
  healthCheck: jest.fn().mockResolvedValue({ status: 'ok' })
}));