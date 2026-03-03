const config = require('../config');
const telegramAlert = require('./telegramAlert');

class TCPMonitor {
  constructor() {
    this.zeroTrafficStart = new Map();
    this.lastSpikeAlert = new Map();
  }

  async checkTraffic(serverName, trafficHistory, currentPps) {
    const now = Date.now();
    
    if (currentPps === 0) {
      const startTime = this.zeroTrafficStart.get(serverName);
      if (!startTime) {
        this.zeroTrafficStart.set(serverName, now);
      } else if (now - startTime > config.thresholds.trafficZero) {
        await telegramAlert.send(
          `🚫 Zero Traffic Detected\nServer: ${serverName}\nDuration: ${Math.round((now - startTime) / 1000)}s`,
          'critical',
          { server: serverName, duration: now - startTime, type: 'zero_traffic' }
        );
        this.zeroTrafficStart.delete(serverName);
      }
    } else {
      this.zeroTrafficStart.delete(serverName);
    }

    if (currentPps > config.thresholds.trafficSpike) {
      const lastAlert = this.lastSpikeAlert.get(serverName) || 0;
      if (now - lastAlert > config.alertCooldown) {
        await telegramAlert.send(
          `📈 Traffic Spike Detected\nServer: ${serverName}\nPackets/sec: ${currentPps.toLocaleString()}`,
          'warning',
          { server: serverName, pps: currentPps, threshold: config.thresholds.trafficSpike, type: 'traffic_spike' }
        );
        this.lastSpikeAlert.set(serverName, now);
      }
    }
  }
}

module.exports = new TCPMonitor();