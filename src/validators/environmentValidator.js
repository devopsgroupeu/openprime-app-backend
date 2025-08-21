// src/validators/environmentValidator.js
const { body } = require('express-validator');

exports.validateEnvironment = [
  body('name')
    .notEmpty().withMessage('Environment name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  
  body('type')
    .notEmpty().withMessage('Environment type is required')
    .isIn(['aws', 'azure', 'gcp', 'onpremise']).withMessage('Invalid environment type'),
  
  body('region')
    .optional()
    .isString().withMessage('Region must be a string'),
  
  body('services')
    .optional()
    .isObject().withMessage('Services must be an object'),
  
  body('services.vpc.enabled')
    .optional()
    .isBoolean().withMessage('VPC enabled must be a boolean'),
  
  body('services.vpc.cidr')
    .optional()
    .matches(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/).withMessage('Invalid CIDR format'),
  
  body('services.eks.enabled')
    .optional()
    .isBoolean().withMessage('EKS enabled must be a boolean'),
  
  body('services.eks.version')
    .optional()
    .matches(/^\d+\.\d+$/).withMessage('Invalid Kubernetes version format'),
  
  body('services.rds.enabled')
    .optional()
    .isBoolean().withMessage('RDS enabled must be a boolean'),
  
  body('services.rds.engine')
    .optional()
    .isIn(['postgres', 'mysql', 'mariadb', 'aurora']).withMessage('Invalid RDS engine')
];
