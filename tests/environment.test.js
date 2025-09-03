// tests/environment.test.js
const request = require('supertest');
const app = require('../src/server');

describe('Environment API', () => {
  describe('POST /api/environments', () => {
    it('should create a new environment', async () => {
      const environmentData = {
        name: 'Test Environment',
        type: 'aws',
        region: 'us-east-1',
        services: {
          vpc: { enabled: true, cidr: '10.0.0.0/16' },
          eks: { enabled: true, version: '1.28' }
        }
      };

      const response = await request(app)
        .post('/api/environments')
        .send(environmentData)
        .expect(201);
      
      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe(environmentData.name);
    });

    it('should validate environment data', async () => {
      const invalidData = {
        type: 'invalid'
      };

      const response = await request(app)
        .post('/api/environments')
        .send(invalidData)
        .expect(400);
      
      expect(response.body).toHaveProperty('errors');
    });
  });
});
