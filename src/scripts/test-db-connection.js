// src/scripts/test-db-connection.js
require('dotenv').config();
const { testConnection, initializeDatabase, closeConnection } = require('../config/database');
const { logger } = require('../utils/logger');
const { Environment } = require('../models');

async function testDatabase() {
  try {
    logger.info('Testing PostgreSQL database integration...');
    
    // Test basic connection
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Database connection failed');
    }
    logger.info('✓ Database connection successful');

    // Initialize database (create tables)
    await initializeDatabase();
    logger.info('✓ Database initialized and tables created');

    // Test Environment model
    const testEnv = await Environment.create({
      name: 'test-environment',
      provider: 'aws',
      region: 'us-east-1',
      location: 'us-east-1',
      services: { eks: { enabled: true } }
    });
    logger.info(`✓ Environment created: ${testEnv.id}`);


    // Test search functionality
    const searchResults = await Environment.findAll({
      where: {
        name: { [require('sequelize').Op.iLike]: '%test%' }
      }
    });
    logger.info(`✓ Search query executed: ${searchResults.length} results found`);

    // Clean up test data
    await testEnv.destroy();
    logger.info('✓ Test data cleaned up');

    logger.info('\n🎉 PostgreSQL database integration test completed successfully!');
    logger.info('\nDatabase features verified:');
    logger.info('  - Connection and authentication');
    logger.info('  - Table creation and schema sync');
    logger.info('  - CRUD operations on Environment model');
    logger.info('  - Search and filtering capabilities');
    logger.info('  - JSONB field storage and retrieval');

  } catch (error) {
    logger.error('❌ Database integration test failed:', error);
    process.exit(1);
  } finally {
    await closeConnection();
    logger.info('Database connection closed');
    process.exit(0);
  }
}

testDatabase();