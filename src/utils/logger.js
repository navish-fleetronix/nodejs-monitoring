const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

class Logger {
  constructor() {
    this.alertsFile = config.alertsFile;
    this.ensureFile();
  }

  async ensureFile() {
    await fs.ensureDir(config.dataDir);
    if (!await fs.pathExists(this.alertsFile)) {
      await fs.writeFile(this.alertsFile, '');
    }
  }

  async log(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
    
    if (level === 'alert') {
      const line = `[${timestamp}] ALERT: ${message} | ${JSON.stringify(metadata)}\n`;
      await fs.appendFile(this.alertsFile, line);
    }
  }

  async getRecentAlerts(limit = 50) {
    if (!await fs.pathExists(this.alertsFile)) return [];
    
    const content = await fs.readFile(this.alertsFile, 'utf8');
    const lines = content.split('\n').filter(Boolean).slice(-limit);
    
    return lines.map(line => {
      const match = line.match(/\[(.*?)\] ALERT: (.*?) \| (.*)/);
      if (match) {
        return {
          timestamp: match[1],
          message: match[2],
          metadata: JSON.parse(match[3])
        };
      }
      return null;
    }).filter(Boolean).reverse();
  }
}

module.exports = new Logger();