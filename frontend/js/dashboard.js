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
    grid.innerHTML = data.nodes.map((node, i) => this.makeNodeCard(node, i)).join('');
  },

  makeNodeCard(node, index) {
    const isHealthy = node.healthy;
    const isParity  = index === 3;
    const role      = isParity ? 'Parity Shard' : `Data Shard ${index}`;
    const usedPct   = node.storage_total > 0
      ? Math.round((node.storage_used / node.storage_total) * 100) : 0;
    const pulseClass = isHealthy ? 'pulse-green' : 'pulse-red';

    return `
      <div class="node-card ${isHealthy ? 'healthy' : 'dead'}" id="node-card-${index}">
        <div class="node-header">
          <div class="pulse-dot ${pulseClass}"></div>
          <span class="node-name">Node ${index}</span>
          <span class="role-badge ${isParity ? 'parity' : 'data'}">${role}</span>
        </div>

        <div class="node-id-text">${node.node_id || 'unknown'}</div>

        <div class="status-badge ${isHealthy ? 'badge-up' : 'badge-down'}">
          ${isHealthy ? '● ONLINE' : '● OFFLINE'}
        </div>

        ${isHealthy ? `
          <div class="node-metrics">
            <div class="metric">
              <span class="metric-val">${node.latency_ms}ms</span>
              <span class="metric-lbl">Latency</span>
            </div>
            <div class="metric">
              <span class="metric-val">${node.shard_count}</span>
              <span class="metric-lbl">Shards</span>
            </div>
            <div class="metric">
              <span class="metric-val">${formatUptime(node.uptime_secs)}</span>
              <span class="metric-lbl">Uptime</span>
            </div>
          </div>
          <div class="storage-bar-wrap">
            <div class="storage-bar">
              <div class="storage-fill" style="width:${usedPct}%"></div>
            </div>
            <span class="storage-pct">${usedPct}%</span>
          </div>
          <div class="storage-text">
            ${formatBytes(node.storage_used)} / ${formatBytes(node.storage_total)}
          </div>
        ` : `
          <div class="error-msg">
            <span class="error-icon">⚠</span>
            ${node.last_error || 'Node unreachable'}
          </div>
          <div class="recovery-hint">Reed-Solomon can reconstruct missing shards</div>
        `}
      </div>
    `;
  },

  renderStats(data) {
    setEl('stat-nodes',  `${data.healthy_nodes}/${data.total_nodes}`);
    setEl('stat-status', data.can_reconstruct ? '✅ Healthy' : '⚠️ Degraded');
    setEl('stat-summary', data.summary);
  },

  updateHeaderBadge(data) {
    const badge = document.getElementById('cluster-badge');
    if (!badge) return;
    badge.textContent = data.can_reconstruct
      ? `✅ ${data.healthy_nodes}/4 Nodes Online`
      : `⚠️ ${data.healthy_nodes}/4 — Degraded`;
    badge.className = 'cluster-badge ' +
      (data.can_reconstruct ? 'badge-healthy' : 'badge-warn');
  },

  renderOffline() {
    const grid = document.getElementById('node-grid');
    grid.innerHTML = `
      <div class="offline-msg">
        <div class="offline-icon">🔌</div>
        <div>Cannot connect to coordinator</div>
        <small>Make sure the backend is running on port 8080</small>
      </div>`;
    const badge = document.getElementById('cluster-badge');
    if (badge) { badge.textContent = '🔴 Offline'; badge.className = 'cluster-badge badge-dead'; }
  },
};

// Helpers
function formatUptime(seconds) {
  if (!seconds) return '0s';
  if (seconds < 60)   return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds/60)}m`;
  return `${Math.floor(seconds/3600)}h`;
}
