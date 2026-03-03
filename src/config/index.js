const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

function parseServers() {
  const servers = [];
  let index = 1;
  
  while (process.env[`SERVER_${index}`]) {
    const config = process.env[`SERVER_${index}`];
    const parts = config.split('|');
    
    if (parts.length >= 6) {
      const [name, host, port, username, auth, healthUrl, healthKey, isIngestion] = parts;
      
      let authConfig;
      if (auth.startsWith('password:')) {
        authConfig = { type: 'password', value: auth.replace('password:', '') };
      } else {
        authConfig = { type: 'privateKey', path: auth };
      }
      
      // Parse health API key - 'none' means no auth required
      let healthApiConfig = null;
      if (healthKey && healthKey !== 'none') {
        if (healthKey.startsWith('Bearer:')) {
          healthApiConfig = { type: 'Bearer', token: healthKey.replace('Bearer:', '') };
        } else if (healthKey.startsWith('Basic:')) {
          healthApiConfig = { type: 'Basic', creds: healthKey.replace('Basic:', '') };
        } else {
          healthApiConfig = { type: 'X-API-Key', key: healthKey };
        }
      }
      
      servers.push({
        name,
        host,
        port: parseInt(port) || 22,
        username,
        auth: authConfig,
        healthUrl,
        healthApiKey: healthApiConfig,
        isIngestion: isIngestion === 'true'
      });
    }
    index++;
  }
  
  return servers;
}

const config = {
  port: parseInt(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  
  checkInterval: parseInt(process.env.CHECK_INTERVAL) || 30000,
  alertCooldown: parseInt(process.env.ALERT_COOLDOWN) || 300000,
  maxMetricsAge: parseInt(process.env.MAX_METRICS_AGE) || 7200000,
  
  thresholds: {
    memory: parseInt(process.env.MEMORY_THRESHOLD) || 85,
    cpu: parseInt(process.env.CPU_THRESHOLD) || 80,
    disk: parseInt(process.env.DISK_THRESHOLD) || 90,
    trafficSpike: parseInt(process.env.TRAFFIC_SPIKE_LIMIT) || 10000,
    trafficZero: parseInt(process.env.TRAFFIC_ZERO_THRESHOLD) || 60000,
    prediction: parseInt(process.env.PREDICTION_THRESHOLD) || 300
  },
  
  apiKey: process.env.MONITOR_API_KEY || 'change-me',
  
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID
  },
  
  servers: parseServers(),
  
  dataDir: path.join(__dirname, '../../data'),
  metricsFile: path.join(__dirname, '../../data/metrics.json'),
  alertsFile: path.join(__dirname, '../../data/alerts.log')
};

module.exports = config;