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
    this.previousNetworkStats = new Map(); // Store previous network readings
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
      // 1. Get system metrics via SSH (memory, CPU, disk, network)
      systemMetrics = await remoteMonitor.getSystemMetrics(server);
      isReachable = true;
    } catch (sshError) {
      logger.log('error', `SSH connection failed for ${server.name}`, { error: sshError.message });
      isReachable = false;
    }

    try {
      // 2. Check HTTP health endpoint (application status)
      healthData = await this.checkHealthEndpoint(server);
    } catch (httpError) {
      logger.log('error', `Health check failed for ${server.name}`, { error: httpError.message });
      healthData = { status: 'down', error: httpError.message };
    }

    // 3. Calculate network PPS if ingestion server
    let packetsPerSecond = 0;
    if (server.isIngestion && systemMetrics?.network) {
      const prev = this.previousNetworkStats.get(server.name);
      packetsPerSecond = remoteMonitor.calculatePPS(
        systemMetrics.network, 
        prev, 
        this.interval
      );
      this.previousNetworkStats.set(server.name, systemMetrics.network);
    }

    // 4. Compile final metrics
    const metrics = {
      timestamp: startTime,
      isReachable,
      status: this.determineStatus(isReachable, healthData, systemMetrics),
      responseTime: Date.now() - startTime,
      
      // System metrics from SSH
      memory: systemMetrics?.memory?.percentage,
      memoryDetails: systemMetrics?.memory,
      cpu: systemMetrics?.cpu?.usage || systemMetrics?.cpu?.loadPercentage,
      cpuDetails: systemMetrics?.cpu,
      disk: systemMetrics?.disk?.percentage,
      diskDetails: systemMetrics?.disk,
      processes: systemMetrics?.processes,
      
      // Network metrics
      packetsPerSecond: server.isIngestion ? packetsPerSecond : undefined,
      
      // Application health from HTTP
      appStatus: healthData?.status,
      appMetrics: healthData?.metrics || {},
      appError: healthData?.error
    };

    // 5. Save metrics
    await metricsStorage.saveMetrics(server.name, metrics);

    // 6. Check thresholds and alert
    await this.checkThresholds(server.name, metrics);

    // 7. Memory prediction
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

    // 8. TCP/Traffic monitoring for ingestion servers
    if (server.isIngestion && metrics.packetsPerSecond !== undefined) {
      const serviceData = await metricsStorage.getServiceMetrics(server.name);
      await tcpMonitor.checkTraffic(
        server.name, 
        serviceData?.trafficHistory || [], 
        metrics.packetsPerSecond
      );
    }

    // 9. Alert if server unreachable or app down
    if (!isReachable || healthData?.status === 'down') {
      await telegramAlert.send(
        `🔥 Server Issue Detected\nServer: ${server.name}\nSSH Reachable: ${isReachable}\nApp Status: ${healthData?.status || 'unknown'}\nError: ${healthData?.error || 'SSH failed'}`,
        'critical',
        { server: server.name, isReachable, appStatus: healthData?.status, type: 'server_down' }
      );
    }
  }

  async checkHealthEndpoint(server) {
    const response = await axios.get(server.healthUrl, {
      headers: { 
        'X-API-Key': server.healthApiKey,
        'Accept': 'application/json'
      },
      timeout: 10000,
      validateStatus: () => true
    });

    return {
      status: response.status === 200 && response.data?.status === 'healthy' ? 'healthy' : 'unhealthy',
      metrics: response.data?.metrics || {},
      raw: response.data
    };
  }

  determineStatus(isReachable, healthData, systemMetrics) {
    if (!isReachable) return 'down';
    if (healthData?.status === 'down') return 'app_down';
    if (healthData?.status === 'unhealthy') return 'unhealthy';
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
          `⚠️ High ${check.label} on ${serverName}\nCurrent: ${check.value.toFixed(1)}% (threshold: ${check.threshold}%)`,
          'warning',
          { server: serverName, metric: check.key, value: check.value, threshold: check.threshold, type: 'threshold_exceeded' }
        );
      }
    }
  }
}

module.exports = new HealthPoller();