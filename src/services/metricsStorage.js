const fs = require('fs-extra');
const config = require('../config');

class MetricsStorage {
  constructor() {
    this.metricsFile = config.metricsFile;
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
    const data = await fs.readJson(this.metricsFile);
    const timestamp = Date.now();
    
    if (!data.servers[serverName]) {
      data.servers[serverName] = {
        history: [],
        trafficHistory: [],
        lastAlert: 0
      };
    }

    const entry = {
      timestamp,
      ...metrics
    };

    // Remove circular references if any
    delete entry.memoryDetails?.swap; // Simplify for storage
    
    data.servers[serverName].history.push(entry);
    data.servers[serverName].lastSeen = timestamp;

    // Keep only last 2 hours
    const cutoff = timestamp - this.maxAge;
    data.servers[serverName].history = data.servers[serverName].history.filter(m => m.timestamp > cutoff);

    // Traffic history for ingestion servers (30 min window)
    if (metrics.packetsPerSecond !== undefined) {
      data.servers[serverName].trafficHistory.push({
        timestamp,
        value: metrics.packetsPerSecond
      });
      const trafficCutoff = timestamp - 1800000;
      data.servers[serverName].trafficHistory = data.servers[serverName].trafficHistory.filter(t => t.timestamp > trafficCutoff);
    }

    data.lastUpdated = timestamp;
    await fs.writeJson(this.metricsFile, data, { spaces: 2 });
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