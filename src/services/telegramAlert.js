const https = require('https');
const config = require('../config');
const logger = require('../utils/logger');

class TelegramAlert {
  constructor() {
    this.botToken = config.telegram.botToken;
    this.chatId = config.telegram.chatId;
    this.cooldowns = new Map();
    this.cooldownPeriod = config.alertCooldown;
    this.enabled = !!(this.botToken && this.chatId);
    
    if (!this.enabled) {
      logger.log('warn', 'Telegram alerts disabled');
    }
  }

  async send(message, severity = 'warning', metadata = {}) {
    if (!this.enabled) {
      logger.log('info', `[ALERT] ${message}`);
      return;
    }

    const key = `${metadata.server || 'system'}-${severity}-${metadata.type || 'general'}`;
    const lastAlert = this.cooldowns.get(key) || 0;
    const now = Date.now();

    if (now - lastAlert < this.cooldownPeriod) {
      return;
    }

    const emoji = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '🟢';
    const fullMessage = `${emoji} *Alert*\n\n${message}`;

    try {
      await this.sendTelegramMessage(fullMessage);
      this.cooldowns.set(key, now);
      await logger.log('alert', message, { severity, ...metadata });
    } catch (error) {
      logger.log('error', 'Telegram failed', { error: error.message });
      // Don't throw - just log
    }
  }

  sendTelegramMessage(text) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        chat_id: this.chatId,
        text: text,
        parse_mode: 'Markdown'
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${this.botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      };

      const req = https.request(options, (res) => {
        let response = '';
        res.on('data', chunk => response += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(JSON.parse(response));
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}

module.exports = new TelegramAlert();