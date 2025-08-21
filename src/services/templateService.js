// src/services/templateService.js
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

class TemplateService {
  constructor() {
    this.templates = new Map();
    this.initializeDefaultTemplates();
  }

  initializeDefaultTemplates() {
    const defaultTemplates = [
      {
        id: 'aws-eks-standard',
        name: 'AWS EKS Standard',
        description: 'Standard EKS cluster with monitoring',
        category: 'aws',
        tags: ['eks', 'kubernetes', 'monitoring'],
        configuration: {
          type: 'aws',
          services: {
            vpc: { enabled: true, cidr: '10.0.0.0/16' },
            eks: { 
              enabled: true, 
              version: '1.28',
              nodeGroups: 2,
              helmCharts: {
                prometheus: { enabled: true },
                grafana: { enabled: true },
                loki: { enabled: false },
                karpenter: { enabled: true }
              }
            },
            rds: { enabled: false }
          }
        }
      },
      {
        id: 'aws-eks-production',
        name: 'AWS EKS Production',
        description: 'Production-ready EKS with full monitoring and HA',
        category: 'aws',
        tags: ['eks', 'kubernetes', 'production', 'ha'],
        configuration: {
          type: 'aws',
          services: {
            vpc: { enabled: true, cidr: '10.0.0.0/16' },
            eks: { 
              enabled: true, 
              version: '1.28',
              nodeGroups: 3,
              helmCharts: {
                prometheus: { enabled: true },
                grafana: { enabled: true },
                loki: { enabled: true },
                karpenter: { enabled: true },
                awsLoadBalancer: { enabled: true },
                argocd: { enabled: true },
                certManager: { enabled: true }
              }
            },
            rds: { 
              enabled: true,
              engine: 'postgres',
              version: '15.4',
              multiAz: true
            }
          }
        }
      },
      {
        id: 'onprem-k8s-basic',
        name: 'On-Premise Kubernetes Basic',
        description: 'Basic on-premise Kubernetes setup',
        category: 'onpremise',
        tags: ['kubernetes', 'onpremise', 'basic'],
        configuration: {
          type: 'onpremise',
          services: {
            kubernetes: { enabled: true, version: '1.28' },
            monitoring: { enabled: true },
            logging: { enabled: false }
          }
        }
      }
    ];

    defaultTemplates.forEach(template => {
      this.templates.set(template.id, {
        ...template,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDefault: true
      });
    });
  }

  async getAllTemplates(filters = {}) {
    let templates = Array.from(this.templates.values());
    
    if (filters.category) {
      templates = templates.filter(t => t.category === filters.category);
    }
    
    if (filters.tags && filters.tags.length > 0) {
      templates = templates.filter(t => 
        filters.tags.some(tag => t.tags.includes(tag))
      );
    }
    
    return templates;
  }

  async getTemplateById(id) {
    return this.templates.get(id);
  }

  async createTemplate(data) {
    const id = uuidv4();
    const template = {
      id,
      ...data,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.templates.set(id, template);
    logger.info(`Template created: ${id}`);
    
    return template;
  }

  async updateTemplate(id, data) {
    const existing = this.templates.get(id);
    if (!existing) {
      throw new Error('Template not found');
    }
    
    if (existing.isDefault) {
      throw new Error('Cannot modify default templates');
    }
    
    const updated = {
      ...existing,
      ...data,
      id, // Preserve ID
      updatedAt: new Date().toISOString()
    };
    
    this.templates.set(id, updated);
    logger.info(`Template updated: ${id}`);
    
    return updated;
  }

  async deleteTemplate(id) {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error('Template not found');
    }
    
    if (template.isDefault) {
      throw new Error('Cannot delete default templates');
    }
    
    this.templates.delete(id);
    logger.info(`Template deleted: ${id}`);
  }

  async cloneTemplate(id, options = {}) {
    const original = this.templates.get(id);
    if (!original) {
      throw new Error('Template not found');
    }
    
    const cloneId = uuidv4();
    const clone = {
      ...original,
      id: cloneId,
      name: options.name || `${original.name} (Copy)`,
      description: options.description || original.description,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    this.templates.set(cloneId, clone);
    logger.info(`Template cloned: ${id} -> ${cloneId}`);
    
    return clone;
  }

  async validateTemplate(data) {
    const errors = [];
    
    if (!data.name) {
      errors.push('Template name is required');
    }
    
    if (!data.category) {
      errors.push('Template category is required');
    }
    
    if (!data.configuration) {
      errors.push('Template configuration is required');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = new TemplateService();
