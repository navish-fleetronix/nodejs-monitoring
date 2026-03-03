const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

class MetricsStorage {
  constructor() {
    this.metricsFile = config.metricsFile;
    this.tempFile = config.metricsFile + '.tmp';
    this.maxAge = config.maxMetricsAge;
    this.ensureFile();
  }

  async ensureFile() {
    await fs.ensureDir(config.dataDir);
    if (!await fs.pathExists(this.metricsFile)) {
      await fs.writeJson(this.metricsFile, { servers: {}, lastUpdated: Date.now() }, { spaces: 2 });
    }
  }

  async saveMetrics(serverName, metrics) {
    try {
      // Read current data
      let data;
      try {
        data = await fs.readJson(this.metricsFile);
      } catch (e) {
        // If corrupted, start fresh
        data = { servers: {}, lastUpdated: Date.now() };
      }
      
      const timestamp = Date.now();
      
      if (!data.servers[serverName]) {
        data.servers[serverName] = {
          history: [],
          trafficHistory: [],
          lastAlert: 0
        };
      }

      const entry = { timestamp, ...metrics };
      data.servers[serverName].history.push(entry);
      data.servers[serverName].lastSeen = timestamp;

      // Keep only last 2 hours
      const cutoff = timestamp - this.maxAge;
      data.servers[serverName].history = data.servers[serverName].history.filter(m => m.timestamp > cutoff);

      // Traffic history for ingestion
      if (metrics.packetsPerSecond !== undefined) {
        data.servers[serverName].trafficHistory.push({ timestamp, value: metrics.packetsPerSecond });
        const trafficCutoff = timestamp - 1800000;
        data.servers[serverName].trafficHistory = data.servers[serverName].trafficHistory.filter(t => t.timestamp > trafficCutoff);
      }

      data.lastUpdated = timestamp;
      
      // Atomic write: write to temp, then rename
      await fs.writeJson(this.tempFile, data, { spaces: 2 });
      await fs.move(this.tempFile, this.metricsFile, { overwrite: true });
      
    } catch (error) {
      console.error('Failed to save metrics:', error.message);
    }
  }

  async getMetrics() {
    try {
      return await fs.readJson(this.metricsFile);
    } catch {
      return { servers: {}, lastUpdated: Date.now() };
    }
  }

  async getServiceMetrics(serverName) {
    const data = await this.getMetrics();
    return data.servers[serverName] || null;
  }

  async getLatestMetrics() {
    const data = await this.getMetrics();
    const latest = {};
    
    for (const [name, server] of Object.entries(data.servers)) {
      const history = server.history || [];
      if (history.length > 0) {
        const last = history[history.length - 1];
        latest[name] = {
          ...last,
          isOnline: (Date.now() - last.timestamp) < config.checkInterval * 2
        };
      }
    }
    
    return latest;
  }
}

module.exports = new MetricsStorage();