// src/services/terraformService.js
// const { logger } = require('../utils/logger'); // Available for future use
const yaml = require('js-yaml');

class TerraformService {
  constructor() {
    this.modules = [
      {
        name: 'vpc',
        provider: 'aws',
        version: '5.0.0',
        description: 'AWS VPC with public and private subnets',
        variables: [
          { name: 'cidr', type: 'string', default: '10.0.0.0/16' },
          { name: 'azs', type: 'list(string)', required: true },
          { name: 'private_subnets', type: 'list(string)', required: true },
          { name: 'public_subnets', type: 'list(string)', required: true }
        ]
      },
      {
        name: 'eks',
        provider: 'aws',
        version: '19.0.0',
        description: 'AWS EKS cluster',
        variables: [
          { name: 'cluster_name', type: 'string', required: true },
          { name: 'cluster_version', type: 'string', default: '1.28' },
          { name: 'vpc_id', type: 'string', required: true },
          { name: 'subnet_ids', type: 'list(string)', required: true }
        ]
      },
      {
        name: 'rds',
        provider: 'aws',
        version: '6.0.0',
        description: 'AWS RDS database',
        variables: [
          { name: 'identifier', type: 'string', required: true },
          { name: 'engine', type: 'string', default: 'postgres' },
          { name: 'engine_version', type: 'string', default: '15.4' },
          { name: 'instance_class', type: 'string', default: 'db.t3.micro' }
        ]
      },
      {
        name: 'alb',
        provider: 'aws',
        version: '9.0.0',
        description: 'AWS Application Load Balancer',
        variables: [
          { name: 'name', type: 'string', required: true },
          { name: 'vpc_id', type: 'string', required: true },
          { name: 'subnets', type: 'list(string)', required: true }
        ]
      }
    ];
  }

  async getAvailableModules() {
    return this.modules;
  }

  async getModuleDetails(moduleName) {
    return this.modules.find(m => m.name === moduleName) || null;
  }

  async convertToYAML(configuration) {
    return yaml.dump(configuration, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });
  }
}

module.exports = new TerraformService();
