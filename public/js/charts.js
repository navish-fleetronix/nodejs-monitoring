let memoryChart, cpuChart, trafficChart;
let currentServer = null;
let serverData = {};

function initCharts() {
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#f8fafc',
                bodyColor: '#94a3b8',
                borderColor: 'rgba(148, 163, 184, 0.2)',
                borderWidth: 1,
                padding: 12,
                displayColors: true,
                callbacks: {
                    title: (context) => {
                        const date = new Date(context[0].parsed.x);
                        return date.toLocaleTimeString();
                    }
                }
            }
        },
        scales: {
            x: {
                type: 'linear',
                display: true,
                grid: {
                    color: 'rgba(148, 163, 184, 0.1)',
                    drawBorder: false
                },
                ticks: {
                    color: '#64748b',
                    callback: function(value) {
                        const date = new Date(value);
                        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    },
                    maxTicksLimit: 6
                }
            },
            y: {
                display: true,
                grid: {
                    color: 'rgba(148, 163, 184, 0.1)',
                    drawBorder: false
                },
                ticks: {
                    color: '#64748b'
                }
            }
        },
        elements: {
            line: {
                tension: 0.4,
                borderWidth: 2
            },
            point: {
                radius: 0,
                hitRadius: 10,
                hoverRadius: 4
            }
        }
    };

    // Memory Chart
    const memCtx = document.getElementById('memoryChart').getContext('2d');
    const memGradient = memCtx.createLinearGradient(0, 0, 0, 280);
    memGradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
    memGradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

    memoryChart = new Chart(memCtx, {
        type: 'line',
        data: { datasets: [] },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    ...commonOptions.scales.y,
                    min: 0,
                    max: 100,
                    ticks: { callback: value => value + '%' }
                }
            }
        }
    });

    // CPU Chart
    const cpuCtx = document.getElementById('cpuChart').getContext('2d');
    const cpuGradient = cpuCtx.createLinearGradient(0, 0, 0, 280);
    cpuGradient.addColorStop(0, 'rgba(6, 182, 212, 0.3)');
    cpuGradient.addColorStop(1, 'rgba(6, 182, 212, 0)');

    cpuChart = new Chart(cpuCtx, {
        type: 'line',
        data: { datasets: [] },
        options: {
            ...commonOptions,
            scales: {
                ...commonOptions.scales,
                y: {
                    ...commonOptions.scales.y,
                    min: 0,
                    max: 100,
                    ticks: { callback: value => value + '%' }
                }
            }
        }
    });

    // Traffic Chart
    const trafficCtx = document.getElementById('trafficChart').getContext('2d');
    const trafficGradient = trafficCtx.createLinearGradient(0, 0, 0, 280);
    trafficGradient.addColorStop(0, 'rgba(16, 185, 129, 0.3)');
    trafficGradient.addColorStop(1, 'rgba(16, 185, 129, 0)');

    trafficChart = new Chart(trafficCtx, {
        type: 'line',
        data: { datasets: [] },
        options: commonOptions
    });
}

function initServerSelectors() {
    const selects = ['memoryServerSelect', 'cpuServerSelect', 'trafficServerSelect'];
    
    selects.forEach(id => {
        const select = document.getElementById(id);
        SERVERS.forEach(server => {
            const option = document.createElement('option');
            option.value = server.name;
            option.textContent = server.name + (server.isIngestion ? ' (Ingestion)' : '');
            select.appendChild(option);
        });
        
        select.addEventListener('change', (e) => {
            currentServer = e.target.value;
            // Sync all selects
            selects.forEach(sid => {
                if (sid !== id) document.getElementById(sid).value = currentServer;
            });
            loadServerHistory(currentServer);
            updateDetails(currentServer);
        });
    });
    
    if (SERVERS.length > 0) {
        currentServer = SERVERS[0].name;
        selects.forEach(id => document.getElementById(id).value = currentServer);
    }
}

async function updateDashboard() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        serverData = data.servers;
        updateServersGrid(data.servers);
        updateAlerts(data.alerts);
        
        if (currentServer && data.servers[currentServer]) {
            updateDetails(currentServer);
            // Only update charts if we have new data point
            const history = await fetch(`/api/history/${currentServer}`).then(r => r.json());
            updateCharts(history);
        }
        
        document.getElementById('lastUpdate').textContent = 
            'Last updated: ' + new Date().toLocaleTimeString();
        document.getElementById('connectionStatus').style.opacity = '1';
        
    } catch (error) {
        console.error('Update failed:', error);
        document.getElementById('connectionStatus').style.opacity = '0.5';
    }
}

function updateServersGrid(servers) {
    const grid = document.getElementById('serversGrid');
    grid.innerHTML = '';
    
    Object.entries(servers).forEach(([name, data]) => {
        const card = createServerCard(name, data);
        grid.appendChild(card);
    });
}

function createServerCard(name, data) {
    const div = document.createElement('div');
    const isIngestion = SERVERS.find(s => s.name === name)?.isIngestion;
    
    let statusClass = '';
    if (!data.isOnline || data.status === 'down') statusClass = 'offline';
    else if (data.status === 'critical' || data.memory > 90) statusClass = 'critical';
    else if (data.memory > 80 || data.cpu > 80) statusClass = 'warning';
    
    div.className = `server-card ${statusClass} ${name === currentServer ? 'active' : ''}`;
    
    const statusText = !data.isOnline ? 'Offline' : 
                      data.status === 'down' ? 'Down' :
                      data.status === 'critical' ? 'Critical' :
                      data.status === 'warning' ? 'Warning' : 'Healthy';
    
    const memoryClass = data.memory > 90 ? 'danger' : data.memory > 80 ? 'warning' : '';
    const cpuClass = data.cpu > 90 ? 'danger' : data.cpu > 80 ? 'warning' : '';
    
    let predictionHtml = '';
    if (data.predictedFullIn && data.predictedFullIn < 600) {
        predictionHtml = `
            <div class="prediction-banner">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                Memory full in ${formatDuration(data.predictedFullIn)}
            </div>
        `;
    }
    
    div.innerHTML = `
        <div class="server-header">
            <div class="server-name">
                ${name}
                ${isIngestion ? '<span class="server-type">Ingestion</span>' : ''}
            </div>
            <div class="server-status">
                <span class="status-dot"></span>
                ${statusText}
            </div>
        </div>
        <div class="metrics-row">
            <div class="metric">
                <div class="metric-value ${memoryClass}">${data.memory !== undefined ? data.memory.toFixed(1) : '-'}</div>
                <div class="metric-label">Memory %</div>
            </div>
            <div class="metric">
                <div class="metric-value ${cpuClass}">${data.cpu !== undefined ? data.cpu.toFixed(1) : '-'}</div>
                <div class="metric-label">CPU %</div>
            </div>
            <div class="metric">
                <div class="metric-value">${data.packetsPerSecond !== undefined ? formatNumber(data.packetsPerSecond) : (isIngestion ? '0' : '-')}</div>
                <div class="metric-label">Pkts/s</div>
            </div>
        </div>
        ${predictionHtml}
        <div class="app-status">
            <span>App Status</span>
            <span class="app-status-value ${data.appStatus === 'healthy' ? '' : 'down'}">${data.appStatus || 'Unknown'}</span>
        </div>
    `;
    
    div.addEventListener('click', () => {
        document.querySelectorAll('.server-card').forEach(c => c.classList.remove('active'));
        div.classList.add('active');
        currentServer = name;
        document.getElementById('memoryServerSelect').value = name;
        document.getElementById('cpuServerSelect').value = name;
        document.getElementById('trafficServerSelect').value = name;
        loadServerHistory(name);
        updateDetails(name);
    });
    
    return div;
}

function updateDetails(serverName) {
    const data = serverData[serverName];
    if (!data) return;
    
    // Disk details
    const diskDiv = document.getElementById('diskDetails');
    if (data.diskDetails) {
        diskDiv.innerHTML = `
            <div class="detail-row">
                <span class="detail-label">Usage</span>
                <span class="detail-value" style="color: ${data.disk > 90 ? 'var(--accent-danger)' : ''}">${data.disk.toFixed(1)}%</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Used</span>
                <span class="detail-value">${formatBytes(data.diskDetails.used)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Available</span>
                <span class="detail-value">${formatBytes(data.diskDetails.available)}</span>
            </div>
            <div class="detail-row">
                <span class="detail-label">Mount</span>
                <span class="detail-value">${data.diskDetails.mount}</span>
            </div>
        `;
    } else {
        diskDiv.innerHTML = '<div class="detail-row"><span class="detail-label">No disk data available</span></div>';
    }
    
    // System details
    const sysDiv = document.getElementById('systemDetails');
    if (data.cpuDetails || data.memoryDetails) {
        let html = '';
        if (data.cpuDetails) {
            html += `
                <div class="detail-row">
                    <span class="detail-label">Load Average (1m)</span>
                    <span class="detail-value">${data.cpuDetails.loadAverage?.['1min']?.toFixed(2) || '-'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">CPU Cores</span>
                    <span class="detail-value">${data.cpuDetails.coreCount || '-'}</span>
                </div>
            `;
        }
        if (data.memoryDetails) {
            html += `
                <div class="detail-row">
                    <span class="detail-label">Total Memory</span>
                    <span class="detail-value">${formatBytes(data.memoryDetails.total)}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Available</span>
                    <span class="detail-value">${formatBytes(data.memoryDetails.available)}</span>
                </div>
            `;
        }
        if (data.processes) {
            html += `
                <div class="detail-row">
                    <span class="detail-label">Processes</span>
                    <span class="detail-value">${data.processes.total}</span>
                </div>
            `;
        }
        sysDiv.innerHTML = html;
    } else {
        sysDiv.innerHTML = '<div class="detail-row"><span class="detail-label">No system data available</span></div>';
    }
}

async function loadServerHistory(serverName) {
    try {
        const response = await fetch(`/api/history/${serverName}`);
        const history = await response.json();
        updateCharts(history);
    } catch (error) {
        console.error('Failed to load history:', error);
    }
}

function updateCharts(history) {
    if (history.length === 0) return;
    
    const labels = history.map(h => h.timestamp);
    const memoryData = history.map(h => ({ x: h.timestamp, y: h.memory || 0 }));
    const cpuData = history.map(h => ({ x: h.timestamp, y: h.cpu || 0 }));
    const trafficData = history.map(h => ({ x: h.timestamp, y: h.packetsPerSecond || 0 }));
    
    // Update Memory Chart
    memoryChart.data.datasets = [{
        label: 'Memory %',
        data: memoryData,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true
    }];
    memoryChart.update('none');
    
    // Update CPU Chart
    cpuChart.data.datasets = [{
        label: 'CPU %',
        data: cpuData,
        borderColor: '#06b6d4',
        backgroundColor: 'rgba(6, 182, 212, 0.1)',
        fill: true
    }];
    cpuChart.update('none');
    
    // Update Traffic Chart
    trafficChart.data.datasets = [{
        label: 'Packets/s',
        data: trafficData,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        stepped: 'middle'
    }];
    trafficChart.update('none');
}

function updateAlerts(alerts) {
    const list = document.getElementById('alertsList');
    list.innerHTML = '';
    
    if (alerts.length === 0) {
        list.innerHTML = '<div style="color: var(--text-secondary); text-align: center; padding: 2rem;">No recent alerts</div>';
        return;
    }
    
    alerts.forEach(alert => {
        const item = document.createElement('div');
        item.className = `alert-item ${alert.metadata?.severity === 'warning' ? 'warning' : ''}`;
        item.innerHTML = `
            <div class="alert-time">${new Date(alert.timestamp).toLocaleTimeString()}</div>
            <div class="alert-content">
                <div class="alert-message">${alert.message}</div>
                <div class="alert-meta">${alert.metadata?.server || 'System'} • ${alert.metadata?.type || 'alert'}</div>
            </div>
        `;
        list.appendChild(item);
    });
}

function formatDuration(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initCharts();
    initServerSelectors();
    updateDashboard();
    setInterval(updateDashboard, REFRESH_INTERVAL);
});