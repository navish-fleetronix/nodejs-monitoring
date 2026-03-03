const config = require('../config');
const telegramAlert = require('./telegramAlert');

class MemoryPredictor {
  predictTimeToFull(history) {
    if (!history || history.length < 5) return null;

    const recent = history.slice(-20);
    const n = recent.length;
    
    if (n < 2) return null;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    recent.forEach((point, index) => {
      const x = index;
      const y = point.memory || 0;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    });

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    if (slope <= 0) return null;

    const currentValue = recent[recent.length - 1].memory || 0;
    const remaining = 100 - currentValue;
    const stepsToFull = remaining / slope;
    const secondsToFull = stepsToFull * (config.checkInterval / 1000);
    
    return Math.max(0, Math.round(secondsToFull));
  }

  async checkAndAlert(serverName, history) {
    const secondsToFull = this.predictTimeToFull(history);
    
    if (secondsToFull !== null && secondsToFull < config.thresholds.prediction) {
      await telegramAlert.send(
        `⚠️ Memory Exhaustion Predicted\nServer: ${serverName}\nTime until 100%: ${this.formatDuration(secondsToFull)}`,
        'warning',
        { server: serverName, secondsToFull, type: 'memory_prediction' }
      );
    }
    
    return secondsToFull;
  }

  formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
}

module.exports = new MemoryPredictor();