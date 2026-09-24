// frontend/js/dashboard.js
// Node status cards + cluster header badge

const Dashboard = {
  pollInterval: null,

  startPolling() {
    this.refresh();
    this.pollInterval = setInterval(() => this.refresh(), 3000);
    Logger.info('📡 Dashboard connected — polling every 3s');
  },

  stopPolling() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  },

  async refresh() {
    try {
      const data = await API.getClusterStatus();
      this.renderNodes(data);
      this.renderStats(data);
      this.updateHeaderBadge(data);
    } catch (err) {
      Logger.error(`Cluster unreachable: ${err.message}`);
      this.renderOffline();
    }
  },

  renderNodes(data) {
    const grid = document.getElementById('node-grid');
    if (!grid) return;
    grid.innerHTML = data.nodes.map((node, i) => this.makeNodeCard(node, i)).join('');
  },

  makeNodeCard(node, index) {
    const isHealthy = node.healthy;
    const isParity  = index === 3;
    const role      = isParity ? 'Parity Shard' : `Data Shard ${index}`;
    const usedPct   = node.storage_total > 0
      ? Math.round((node.storage_used / node.storage_total) * 100) : 0;

    return `
      <div class="node-card ${isHealthy ? 'healthy' : 'dead'}" id="node-card-${index}">
        <div class="node-card-top">
          <div class="node-title-group">
            <span class="node-name">Node ${index}</span>
          </div>
          <span class="role-badge ${isParity ? 'parity' : 'data'}">${role}</span>
        </div>

        <div class="node-id-pill" title="${node.node_id || 'unknown'}">
          ${node.node_id || `storage-node-${index}:50051`}
        </div>

        <div class="node-status-pill ${isHealthy ? 'pill-online' : 'pill-offline'}">
          <div class="pulse-halo ${isHealthy ? 'online' : 'offline'}"></div>
          <span>${isHealthy ? 'ONLINE' : 'OFFLINE'}</span>
        </div>

        ${isHealthy ? `
          <div class="node-metrics">
            <div class="metric-col">
              <span class="metric-num">${node.latency_ms}ms</span>
              <span class="metric-lbl">Latency</span>
            </div>
            <div class="metric-col">
              <span class="metric-num">${node.shard_count}</span>
              <span class="metric-lbl">Shards</span>
            </div>
            <div class="metric-col">
              <span class="metric-num">${formatUptime(node.uptime_secs)}</span>
              <span class="metric-lbl">Uptime</span>
            </div>
          </div>

          <div class="storage-box">
            <div class="storage-bar-header">
              <span>Storage <strong>${usedPct}%</strong></span>
              <span>${formatBytes(node.storage_used)} / ${formatBytes(node.storage_total)}</span>
            </div>
            <div class="storage-track">
              <div class="storage-fill" style="width:${usedPct}%"></div>
            </div>
          </div>
        ` : `
          <div class="error-msg">
            <span>⚠</span>
            <span>${node.last_error || 'Node unreachable'}</span>
          </div>
          <div class="recovery-hint">
            Reed-Solomon RS(3+1) parity is actively reconstructing missing shards on read.
          </div>
        `}
      </div>
    `;
  },

  renderStats(data) {
    setEl('stat-nodes', `${data.healthy_nodes}/${data.total_nodes}`);
    setEl('stat-status', data.can_reconstruct ? 'Fault-Tolerant' : 'Degraded');
    setEl('stat-summary', data.summary || 'Cluster operational');
  },

  updateHeaderBadge(data) {
    const badge = document.getElementById('cluster-badge');
    if (!badge) return;
    const isOk = data.can_reconstruct;
    badge.innerHTML = `
      <span class="pulse-halo ${isOk ? 'online' : 'offline'}"></span>
      <span>${data.healthy_nodes}/${data.total_nodes} Nodes Healthy</span>
    `;
    badge.className = 'cluster-badge ' + (isOk ? 'badge-healthy' : 'badge-warn');
  },

  renderOffline() {
    const grid = document.getElementById('node-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="offline-msg">
          <div class="offline-icon">🔌</div>
          <div style="font-weight:600;font-size:1.1rem;margin-bottom:4px;">Cannot connect to coordinator</div>
          <small style="color:var(--text-tertiary)">Make sure the backend is running on port 8080</small>
        </div>`;
    }
    const badge = document.getElementById('cluster-badge');
    if (badge) {
      badge.innerHTML = `<span class="pulse-halo offline"></span><span>Backend Offline</span>`;
      badge.className = 'cluster-badge badge-dead';
    }
  },
};

// Helpers
function formatUptime(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m`;
  return `${Math.floor(seconds/3600)}h`;
}
