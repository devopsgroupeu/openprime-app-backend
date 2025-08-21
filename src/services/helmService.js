// src/services/helmService.js
// const { logger } = require('../utils/logger'); // Available for future use
// const yaml = require('js-yaml'); // Available for future use

class HelmService {
  constructor() {
    // Available Helm charts configuration
    this.availableCharts = [
      {
        name: 'prometheus',
        repository: 'https://prometheus-community.github.io/helm-charts',
        version: '25.0.0',
        description: 'Prometheus monitoring system'
      },
      {
        name: 'grafana',
        repository: 'https://grafana.github.io/helm-charts',
        version: '7.0.0',
        description: 'Grafana visualization platform'
      },
      {
        name: 'loki',
        repository: 'https://grafana.github.io/helm-charts',
        version: '5.0.0',
        description: 'Loki log aggregation system'
      },
      {
        name: 'karpenter',
        repository: 'oci://public.ecr.aws/karpenter/karpenter',
        version: '0.33.0',
        description: 'Kubernetes node autoscaling'
      },
      {
        name: 'aws-load-balancer-controller',
        repository: 'https://aws.github.io/eks-charts',
        version: '1.6.0',
        description: 'AWS Load Balancer Controller'
      },
      {
        name: 'argocd',
        repository: 'https://argoproj.github.io/argo-helm',
        version: '5.51.0',
        description: 'ArgoCD GitOps controller'
      },
      {
        name: 'istio',
        repository: 'https://istio-release.storage.googleapis.com/charts',
        version: '1.20.0',
        description: 'Istio service mesh'
      },
      {
        name: 'cert-manager',
        repository: 'https://charts.jetstack.io',
        version: '1.13.0',
        description: 'Certificate management'
      }
    ];
    
    // Default values for each chart
    this.defaultValues = {
      prometheus: `alertmanager:
  enabled: true
  persistentVolume:
    enabled: true
    size: 10Gi
server:
  persistentVolume:
    enabled: true
    size: 50Gi
  retention: "30d"
  resources:
    requests:
      cpu: 500m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi`,
      
      grafana: `adminPassword: "changeme"
persistence:
  enabled: true
  size: 10Gi
datasources:
  datasources.yaml:
    apiVersion: 1
    datasources:
    - name: Prometheus
      type: prometheus
      url: http://prometheus-server:80
      isDefault: true`,
      
      loki: `persistence:
  enabled: true
  size: 10Gi
config:
  auth_enabled: false
  ingester:
    chunk_idle_period: 3m
    chunk_retain_period: 1m`,
      
      karpenter: `settings:
  aws:
    clusterName: "eks-cluster"
    defaultInstanceProfile: "KarpenterNodeInstanceProfile"
    interruptionQueueName: "karpenter-interruption"`,
      
      'aws-load-balancer-controller': `clusterName: eks-cluster
serviceAccount:
  create: true
  name: aws-load-balancer-controller`,
      
      argocd: `server:
  extraArgs:
    - --insecure
  config:
    repositories: |
      - type: git
        url: https://github.com/your-org/your-repo`,
      
      istio: `global:
  defaultPodDisruptionBudget:
    enabled: true
  proxy:
    resources:
      requests:
        cpu: 100m
        memory: 128Mi`,
      
      'cert-manager': `installCRDs: true
replicaCount: 1
webhook:
  replicaCount: 1
cainjector:
  replicaCount: 1`
    };
  }

  async getAvailableCharts() {
    return this.availableCharts;
  }

  async getChartDetails(chartName) {
    const chart = this.availableCharts.find(c => c.name === chartName);
    if (!chart) {
      return null;
    }
    
    return {
      ...chart,
      valuesSchema: this.getChartSchema(chartName),
      defaultValues: this.defaultValues[chartName]
    };
  }

  async getDefaultValues(chartName) {
    return this.defaultValues[chartName] || '';
  }

  getChartSchema(chartName) {
    // In production, this would fetch actual JSON schema from chart repository
    const schemas = {
      prometheus: {
        type: 'object',
        properties: {
          alertmanager: { type: 'object' },
          server: { type: 'object' }
        }
      },
      grafana: {
        type: 'object',
        properties: {
          adminPassword: { type: 'string' },
          persistence: { type: 'object' },
          datasources: { type: 'object' }
        }
      }
    };
    
    return schemas[chartName] || { type: 'object' };
  }
}

module.exports = new HelmService();
