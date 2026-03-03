const { NodeSSH } = require('node-ssh');
const config = require('../config');
const logger = require('../utils/logger');

class RemoteMonitor {
  constructor() {
    this.sshConnections = new Map();
  }

  async getSystemMetrics(serverConfig) {
    const ssh = new NodeSSH();
    
    try {
      // Connect via SSH
      await this.connect(ssh, serverConfig);
      
      // Execute commands to get metrics
      const [memoryInfo, cpuInfo, diskInfo, networkInfo, processInfo] = await Promise.all([
        this.getMemoryInfo(ssh),
        this.getCPUInfo(ssh),
        this.getDiskInfo(ssh),
        serverConfig.isIngestion ? this.getNetworkStats(ssh) : Promise.resolve(null),
        this.getProcessInfo(ssh)
      ]);

      return {
        memory: memoryInfo,
        cpu: cpuInfo,
        disk: diskInfo,
        network: networkInfo,
        processes: processInfo,
        timestamp: Date.now()
      };

    } catch (error) {
      throw new Error(`SSH failed for ${serverConfig.name}: ${error.message}`);
    } finally {
      ssh.dispose();
    }
  }

  async connect(ssh, serverConfig) {
    const connectConfig = {
      host: serverConfig.host,
      port: serverConfig.port,
      username: serverConfig.username,
      readyTimeout: 20000
    };

    if (serverConfig.auth.type === 'password') {
      connectConfig.password = serverConfig.auth.value;
    } else {
      connectConfig.privateKeyPath = serverConfig.auth.path;
    }

    await ssh.connect(connectConfig);
  }

  async getMemoryInfo(ssh) {
    // Get memory info from /proc/meminfo
    const result = await ssh.execCommand('cat /proc/meminfo');
    
    const lines = result.stdout.split('\n');
    const memInfo = {};
    
    lines.forEach(line => {
      const match = line.match(/^(\w+):\s+(\d+)/);
      if (match) {
        memInfo[match[1]] = parseInt(match[2]) * 1024; // Convert KB to bytes
      }
    });

    const total = memInfo.MemTotal || 0;
    const available = memInfo.MemAvailable || memInfo.MemFree || 0;
    const used = total - available;
    
    // Also get swap info
    const swapTotal = memInfo.SwapTotal || 0;
    const swapFree = memInfo.SwapFree || 0;
    const swapUsed = swapTotal - swapFree;

    return {
      total,
      used,
      available,
      percentage: total > 0 ? parseFloat(((used / total) * 100).toFixed(2)) : 0,
      swap: {
        total: swapTotal,
        used: swapUsed,
        percentage: swapTotal > 0 ? parseFloat(((swapUsed / swapTotal) * 100).toFixed(2)) : 0
      }
    };
  }

  async getCPUInfo(ssh) {
    // Get CPU usage using top (single sample)
    const result = await ssh.execCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1");
    
    let usage = 0;
    if (result.stdout) {
      usage = parseFloat(result.stdout.trim()) || 0;
    }

    // Alternative: read from /proc/stat for more accuracy
    const statResult = await ssh.execCommand('cat /proc/stat | head -1');
    // Parse CPU stats (simplified)
    
    // Get load average
    const loadResult = await ssh.execCommand('uptime | awk -F"load average:" \'{print $2}\'');
    const loadAvgs = loadResult.stdout.trim().split(',').map(s => parseFloat(s.trim()) || 0);

    // Get CPU count
    const cpuCountResult = await ssh.execCommand('nproc');
    const cpuCount = parseInt(cpuCountResult.stdout.trim()) || 1;

    return {
      usage: parseFloat(usage.toFixed(2)),
      loadAverage: {
        '1min': loadAvgs[0] || 0,
        '5min': loadAvgs[1] || 0,
        '15min': loadAvgs[2] || 0
      },
      loadPercentage: parseFloat(((loadAvgs[0] / cpuCount) * 100).toFixed(2)),
      coreCount: cpuCount
    };
  }

  async getDiskInfo(ssh) {
    // Get disk usage for root partition
    const result = await ssh.execCommand("df -h / | tail -1 | awk '{print $5}' | sed 's/%//'");
    
    let percentage = 0;
    if (result.stdout) {
      percentage = parseInt(result.stdout.trim()) || 0;
    }

    // Get detailed info
    const detailResult = await ssh.execCommand("df -B1 / | tail -1");
    const parts = detailResult.stdout.trim().split(/\s+/);
    
    return {
      percentage,
      total: parseInt(parts[1]) || 0,
      used: parseInt(parts[2]) || 0,
      available: parseInt(parts[3]) || 0,
      mount: parts[5] || '/'
    };
  }

  async getNetworkStats(ssh) {
    // Get network interface statistics
    // Assumes eth0 or finds primary interface
    const ifaceResult = await ssh.execCommand("ip route | grep default | awk '{print $5}' | head -1");
    const iface = ifaceResult.stdout.trim() || 'eth0';

    // Get current stats
    const rxResult = await ssh.execCommand(`cat /sys/class/net/${iface}/statistics/rx_packets`);
    const txResult = await ssh.execCommand(`cat /sys/class/net/${iface}/statistics/tx_packets`);
    
    const rxPackets = parseInt(rxResult.stdout.trim()) || 0;
    const txPackets = parseInt(txResult.stdout.trim()) || 0;

    // Calculate packets per second (requires previous reading)
    // We'll store raw values and calculate delta in the poller
    return {
      interface: iface,
      rxPackets,
      txPackets,
      totalPackets: rxPackets + txPackets
    };
  }

  async getProcessInfo(ssh) {
    // Get process count and top memory consumers
    const countResult = await ssh.execCommand('ps aux | wc -l');
    const processCount = parseInt(countResult.stdout.trim()) - 1 || 0;

    // Get zombie processes
    const zombieResult = await ssh.execCommand('ps aux | grep -c "\\<Z\\>"');
    const zombieCount = parseInt(zombieResult.stdout.trim()) || 0;

    return {
      total: processCount,
      zombie: zombieCount
    };
  }

  // Calculate packets per second from two readings
  calculatePPS(current, previous, intervalMs) {
    if (!previous || !current) return 0;
    
    const packetDiff = current.totalPackets - previous.totalPackets;
    const seconds = intervalMs / 1000;
    
    return Math.max(0, Math.round(packetDiff / seconds));
  }
}

module.exports = new RemoteMonitor();