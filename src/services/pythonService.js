// src/services/pythonService.js
const { spawn } = require('child_process');
const path = require('path');
const { logger } = require('../utils/logger');

class PythonService {
  constructor() {
    this.pythonPath = process.env.PYTHON_PATH || 'python3';
    this.scriptsPath = process.env.PYTHON_SCRIPTS_PATH || path.join(__dirname, '../../python');
  }

  async executePythonScript(scriptName, data) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(this.scriptsPath, scriptName);
      const pythonProcess = spawn(this.pythonPath, [scriptPath]);
      
      let outputData = '';
      let errorData = '';
      
      // Send data to Python script
      pythonProcess.stdin.write(JSON.stringify(data));
      pythonProcess.stdin.end();
      
      pythonProcess.stdout.on('data', (data) => {
        outputData += data.toString();
      });
      
      pythonProcess.stderr.on('data', (data) => {
        errorData += data.toString();
      });
      
      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          logger.error(`Python script ${scriptName} exited with code ${code}`);
          reject(new Error(errorData || 'Python script failed'));
        } else {
          try {
            const result = JSON.parse(outputData);
            resolve(result);
          } catch (e) {
            resolve(outputData);
          }
        }
      });
    });
  }

  async processEnvironmentConfig(yamlData) {
    return this.executePythonScript('process_environment.py', { yaml: yamlData });
  }

  async deployEnvironment(environment, options) {
    return this.executePythonScript('deploy_environment.py', { 
      environment, 
      options 
    });
  }

  async generateIaC(environment, format) {
    return this.executePythonScript('generate_iac.py', { 
      environment, 
      format 
    });
  }

  async validateHelmValues(chartName, values) {
    return this.executePythonScript('validate_helm.py', { 
      chart: chartName, 
      values 
    });
  }

  async generateHelmValues(configuration) {
    return this.executePythonScript('generate_helm_values.py', { 
      configuration 
    });
  }

  async generateTerraform(configuration) {
    return this.executePythonScript('generate_terraform.py', { 
      configuration 
    });
  }

  async validateTerraform(configuration) {
    return this.executePythonScript('validate_terraform.py', { 
      configuration 
    });
  }

  async planTerraform(configuration) {
    return this.executePythonScript('plan_terraform.py', { 
      configuration 
    });
  }

  async exportTerraform(configuration) {
    return this.executePythonScript('export_terraform.py', { 
      configuration 
    });
  }
}

module.exports = new PythonService();
