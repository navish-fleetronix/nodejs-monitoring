const express = require('express');
const router = express.Router();
const metricsStorage = require('../services/metricsStorage');
const logger = require('../utils/logger');
const config = require('../config');

// Dashboard UI
router.get('/', (req, res) => {
  res.render('dashboard', { 
    title: 'Remote Infrastructure Monitor',
    refreshInterval: config.checkInterval,
    servers: config.servers.map(s => ({ name: s.name, isIngestion: s.isIngestion }))
  });
});

// API: Current status
router.get('/api/status', async (req, res) => {
  try {
    const metrics = await metricsStorage.getLatestMetrics();
    const alerts = await logger.getRecentAlerts(10);
    
    res.json({
      servers: metrics,
      alerts,
      timestamp: Date.now(),
      config: {
        thresholds: config.thresholds,
        checkInterval: config.checkInterval
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Historical data for charts
router.get('/api/history/:server', async (req, res) => {
  try {
    const data = await metricsStorage.getServiceMetrics(req.params.server);
    if (!data) return res.status(404).json({ error: 'Server not found' });
    
    // Return last 100 points for charts
    const history = data.history.slice(-100).map(h => ({
      timestamp: h.timestamp,
      memory: h.memory,
      cpu: h.cpu,
      disk: h.disk,
      packetsPerSecond: h.packetsPerSecond,
      status: h.status
    }));
    
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Server details
router.get('/api/servers', (req, res) => {
  res.json(config.servers.map(s => ({
    name: s.name,
    host: s.host,
    isIngestion: s.isIngestion
  })));
});

module.exports = router;