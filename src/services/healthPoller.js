const axios = require('axios');
const config = require('../config');
const remoteMonitor = require('./remoteMonitor');
const metricsStorage = require('./metricsStorage');
const telegramAlert = require('./telegramAlert');
const memoryPredictor = require('./memoryPredictor');
const tcpMonitor = require('./tcpMonitor');
const logger = require('../utils/logger');

class HealthPoller {
  constructor() {
    this.servers = config.servers;
    this.interval = config.checkInterval;
    this.isRunning = false;
    this.timer = null;
    this.previousNetworkStats = new Map();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    logger.log('info', 'Remote health poller started', { 
      interval: this.interval,
      servers: this.servers.map(s => s.name)
    });
    
    this.checkAll();
    this.timer = setInterval(() => this.checkAll(), this.interval);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.log('info', 'Health poller stopped');
  }

  async checkAll() {
    await Promise.all(this.servers.map(server => this.checkServer(server)));
  }

  async checkServer(server) {
    const startTime = Date.now();
    let systemMetrics = null;
    let healthData = null;
    let isReachable = false;

    try {
      systemMetrics = await remoteMonitor.getSystemMetrics(server);
      isReachable = true;
    } catch (sshError) {
      logger.log('error', `SSH failed for ${server.name}`, { error: sshError.message });
    }

    try {
      healthData = await this.checkHealthEndpoint(server);
    } catch (httpError) {
      logger.log('error', `Health check failed for ${server.name}`, { error: httpError.message });
      healthData = { status: 'down', error: httpError.message };
    }

    let packetsPerSecond = 0;
    if (server.isIngestion && systemMetrics?.network) {
      const prev = this.previousNetworkStats.get(server.name);
      packetsPerSecond = remoteMonitor.calculatePPS(systemMetrics.network, prev, this.interval);
      this.previousNetworkStats.set(server.name, systemMetrics.network);
    }

    const metrics = {
      timestamp: startTime,
      isReachable,
      status: this.determineStatus(isReachable, healthData, systemMetrics),
      responseTime: Date.now() - startTime,
      memory: systemMetrics?.memory?.percentage,
      memoryDetails: systemMetrics?.memory,
      cpu: systemMetrics?.cpu?.usage || systemMetrics?.cpu?.loadPercentage,
      cpuDetails: systemMetrics?.cpu,
      disk: systemMetrics?.disk?.percentage,
      diskDetails: systemMetrics?.disk,
      packetsPerSecond: server.isIngestion ? packetsPerSecond : undefined,
      appStatus: healthData?.status,
      appError: healthData?.error
    };

    await metricsStorage.saveMetrics(server.name, metrics);
    await this.checkThresholds(server.name, metrics);

    if (metrics.memory !== undefined) {
      const serviceData = await metricsStorage.getServiceMetrics(server.name);
      if (serviceData?.history) {
        const prediction = await memoryPredictor.checkAndAlert(server.name, serviceData.history);
        if (prediction) {
          metrics.predictedFullIn = prediction;
          await metricsStorage.saveMetrics(server.name, metrics);
        }
      }
    }

    if (server.isIngestion && metrics.packetsPerSecond !== undefined) {
      const serviceData = await metricsStorage.getServiceMetrics(server.name);
      await tcpMonitor.checkTraffic(server.name, serviceData?.trafficHistory || [], metrics.packetsPerSecond);
    }

    if (!isReachable || healthData?.status === 'down') {
      await telegramAlert.send(
        `🔥 Server Issue: ${server.name}\nSSH: ${isReachable ? 'OK' : 'FAIL'}\nApp: ${healthData?.status || 'unknown'}`,
        'critical',
        { server: server.name, isReachable, appStatus: healthData?.status, type: 'server_down' }
      );
    }
  }

    async checkHealthEndpoint(server) {
    const headers = {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'NodeJS-Monitor/2.0'
    };
    
    if (server.healthApiKey?.type === 'Bearer') {
      headers['Authorization'] = `Bearer ${server.healthApiKey.token}`;
    }

    try {
      const response = await axios.get(server.healthUrl, {
        headers,
        timeout: 10000,
        validateStatus: () => true
      });

      let isHealthy = false;
      
      // HTTP 200 = base requirement
      if (response.status === 200) {
        const data = response.data;
        
        if (typeof data === 'object' && data !== null) {
          // Check multiple possible healthy indicators
          isHealthy = 
            // Standard fields
            data.status === 'healthy' ||
            data.status === 'up' ||
            data.status === 'ok' ||
            data.ok === true ||
            data.healthy === true ||
            data.success === true ||
            data.code === 200 ||
            data.state === 'running' ||
            // YOUR CUSTOM FORMAT
            (data.Message && data.Message.toLowerCase().includes('completed')) ||
            (data.message && data.message.toLowerCase().includes('completed')) ||
            (data.Message && data.Message.toLowerCase().includes('ok')) ||
            (data.message && data.message.toLowerCase().includes('ok')) ||
            (data.Message && data.Message.toLowerCase().includes('success')) ||
            (data.message && data.message.toLowerCase().includes('success'));
        } else if (typeof data === 'string') {
          isHealthy = 
            data.toLowerCase().includes('ok') ||
            data.toLowerCase().includes('healthy') ||
            data.toLowerCase().includes('completed') ||
            data.toLowerCase().includes('success');
        } else {
          isHealthy = true; // Empty 200 = healthy
        }
      }

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        statusCode: response.status,
        data: response.data
      };
      
    } catch (error) {
      return {
        status: 'down',
        statusCode: 0,
        error: error.message
      };
    }
  }

  determineStatus(isReachable, healthData, systemMetrics) {
    if (!isReachable) return 'down';
    if (healthData?.status === 'down') return 'app_down';
    if (systemMetrics?.memory?.percentage > 95) return 'critical';
    return 'healthy';
  }

  async checkThresholds(serverName, metrics) {
    const checks = [
      { key: 'memory', threshold: config.thresholds.memory, label: 'Memory', value: metrics.memory },
      { key: 'cpu', threshold: config.thresholds.cpu, label: 'CPU', value: metrics.cpu },
      { key: 'disk', threshold: config.thresholds.disk, label: 'Disk', value: metrics.disk }
    ];

    for (const check of checks) {
      if (check.value !== undefined && check.value > check.threshold) {
        await telegramAlert.send(
          `⚠️ High ${check.label} on ${serverName}: ${check.value.toFixed(1)}%`,
          'warning',
          { server: serverName, metric: check.key, value: check.value, threshold: check.threshold }
        );
      }
    }
  }
}

module.exports = new HealthPoller();