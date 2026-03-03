const { NodeSSH } = require('node-ssh');
const config = require('../config');

class RemoteMonitor {
  constructor() {
    this.previousNetworkStats = new Map();
  }

  async getSystemMetrics(serverConfig) {
    const ssh = new NodeSSH();
    
    try {
      await this.connect(ssh, serverConfig);
      
      const [memoryInfo, cpuInfo, diskInfo, networkInfo] = await Promise.all([
        this.getMemoryInfo(ssh),
        this.getCPUInfo(ssh),
        this.getDiskInfo(ssh),
        serverConfig.isIngestion ? this.getNetworkStats(ssh) : Promise.resolve(null)
      ]);

      return {
        memory: memoryInfo,
        cpu: cpuInfo,
        disk: diskInfo,
        network: networkInfo,
        timestamp: Date.now()
      };

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
    const result = await ssh.execCommand('cat /proc/meminfo');
    const lines = result.stdout.split('\n');
    const memInfo = {};
    
    lines.forEach(line => {
      const match = line.match(/^(\w+):\s+(\d+)/);
      if (match) {
        memInfo[match[1]] = parseInt(match[2]) * 1024;
      }
    });

    const total = memInfo.MemTotal || 0;
    const available = memInfo.MemAvailable || memInfo.MemFree || 0;
    const used = total - available;
    
    return {
      total,
      used,
      available,
      percentage: total > 0 ? parseFloat(((used / total) * 100).toFixed(2)) : 0
    };
  }

  async getCPUInfo(ssh) {
    const result = await ssh.execCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | cut -d'%' -f1");
    let usage = parseFloat(result.stdout.trim()) || 0;

    const loadResult = await ssh.execCommand('uptime | awk -F"load average:" \'{print $2}\'');
    const loadAvgs = loadResult.stdout.trim().split(',').map(s => parseFloat(s.trim()) || 0);

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
  try {
    // Get percentage
    const pctResult = await ssh.execCommand("df -h / | tail -1 | awk '{print $5}' | sed 's/%//'");
    const percentage = parseInt(pctResult.stdout.trim()) || 0;

    // Get full details with mount point
    const detailResult = await ssh.execCommand("df -h / | tail -1");
    // Example outputs:
    // /dev/sda1       50G   30G   20G  60% /
    // or
    // Filesystem     Size  Used Avail Use% Mounted on
    // /dev/sda1       50G   30G   20G  60% /
    
    const line = detailResult.stdout.trim();
    const parts = line.split(/\s+/);
    
    // Find mount point (usually last column)
    let mount = '/';
    let total = 0, used = 0, available = 0;
    
    if (parts.length >= 6) {
      // Standard format: filesystem size used avail use% mount
      total = this.parseSize(parts[1]);
      used = this.parseSize(parts[2]);
      available = this.parseSize(parts[3]);
      mount = parts[5] || parts[parts.length - 1] || '/';
    } else if (parts.length === 1) {
      // Just filesystem, use defaults
      mount = '/';
    }
    
    return {
      percentage,
      total,
      used,
      available,
      mount  // ← Now properly extracted
    };
  } catch (error) {
    logger.log('error', 'Failed to get disk info', { error: error.message });
    return { percentage: 0, total: 0, used: 0, available: 0, mount: '/' };
  }
}

// Helper to parse size like "50G", "100M", "1T"
parseSize(sizeStr) {
  if (!sizeStr) return 0;
  const num = parseFloat(sizeStr);
  const unit = sizeStr.slice(-1).toUpperCase();
  
  const multipliers = {
    'K': 1024,
    'M': 1024 * 1024,
    'G': 1024 * 1024 * 1024,
    'T': 1024 * 1024 * 1024 * 1024
  };
  
  return Math.floor(num * (multipliers[unit] || 1));
}

  async getNetworkStats(ssh) {
    const ifaceResult = await ssh.execCommand("ip route | grep default | awk '{print $5}' | head -1");
    const iface = ifaceResult.stdout.trim() || 'eth0';

    const rxResult = await ssh.execCommand(`cat /sys/class/net/${iface}/statistics/rx_packets`);
    const txResult = await ssh.execCommand(`cat /sys/class/net/${iface}/statistics/tx_packets`);
    
    const rxPackets = parseInt(rxResult.stdout.trim()) || 0;
    const txPackets = parseInt(txResult.stdout.trim()) || 0;

    return {
      interface: iface,
      rxPackets,
      txPackets,
      totalPackets: rxPackets + txPackets
    };
  }

  calculatePPS(current, previous, intervalMs) {
    if (!previous || !current) return 0;
    const packetDiff = current.totalPackets - previous.totalPackets;
    const seconds = intervalMs / 1000;
    return Math.max(0, Math.round(packetDiff / seconds));
  }
}

module.exports = new RemoteMonitor();