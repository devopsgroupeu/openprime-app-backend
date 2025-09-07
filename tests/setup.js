// tests/setup.js
process.env.NODE_ENV = 'test';
process.env.DB_NAME = 'openprime_test';
process.env.LOG_LEVEL = 'error'; // Minimize logging during tests

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
    close: jest.fn().mockResolvedValue(true)
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
    stream: { write: jest.fn() }
  }
}));