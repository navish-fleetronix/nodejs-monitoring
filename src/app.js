const express = require('express');
const path = require('path');
const config = require('./config');
const healthPoller = require('./services/healthPoller');
const dashboardRoutes = require('./routes/dashboard');
const logger = require('./utils/logger');

const app = express();

// View engine - views folder is now at root
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Static files - public folder is at root
app.use(express.static(path.join(__dirname, '../public')));

// Routes
app.use('/', dashboardRoutes);

// Health check for monitoring server itself
app.get('/health', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== config.apiKey) {
    return res.status(401).json({ status: 'unauthorized' });
  }
  
  res.json({
    status: 'healthy',
    service: 'nodejs-monitoring',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Error handling
app.use((err, req, res, next) => {
  logger.log('error', 'Express error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const server = app.listen(config.port, async () => {
  await logger.log('info', `Monitoring server started`, { port: config.port });
  healthPoller.start();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.log('info', 'SIGTERM received, shutting down gracefully');
  healthPoller.stop();
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.log('info', 'SIGINT received, shutting down gracefully');
  healthPoller.stop();
  server.close(() => process.exit(0));
});