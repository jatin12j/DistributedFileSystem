// frontend/js/dashboard.js
// Industrial Hardware Slot & Cluster Health Telemetry

const Dashboard = {
  pollInterval: null,

  startPolling() {
    this.refresh();
    this.pollInterval = setInterval(() => this.refresh(), 3000);
    Logger.info('[HEARTBEAT] Telemetry active — polling coordinator at 3000ms');
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
      this.updateReconstructionPipeline(data);
    } catch (err) {
      Logger.error(`[CLUSTER_UNREACHABLE] ${err.message}`);
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
    const roleTag   = isParity ? 'PARITY [RS]' : `DATA [D${index}]`;
    const slotIdx   = String(index).padStart(2, '0');
    const usedPct   = node.storage_total > 0
      ? Math.round((node.storage_used / node.storage_total) * 100) : 0;

    return `
      <div class="node-card ${isHealthy ? 'healthy' : 'dead'}" id="node-card-${index}">
        <div class="node-card-top">
          <div class="node-title-group">
            <span class="node-slot-idx">SLOT_${slotIdx}</span>
            <span class="node-name">NODE_${index}</span>
          </div>
          <span class="role-badge ${isParity ? 'parity' : 'data'}">${roleTag}</span>
        </div>

        <div class="node-id-pill" title="${node.node_id || 'unknown'}">
          ${node.address || `storage-node-${index}:50051`}
        </div>

        <div class="node-status-pill ${isHealthy ? 'pill-online' : 'pill-offline'}">
          <span class="pulse-halo ${isHealthy ? 'online' : 'offline'}"></span>
          <span>${isHealthy ? 'ONLINE' : 'OFFLINE'}</span>
        </div>

        ${isHealthy ? `
          <div class="node-metrics">
            <div class="metric-col">
              <span class="metric-num">${node.latency_ms}ms</span>
              <span class="metric-lbl">RTT</span>
            </div>
            <div class="metric-col">
              <span class="metric-num">${node.shard_count}</span>
              <span class="metric-lbl">SHARDS</span>
            </div>
            <div class="metric-col">
              <span class="metric-num">${formatUptime(node.uptime_secs)}</span>
              <span class="metric-lbl">UPTIME</span>
            </div>
          </div>

          <div class="storage-box">
            <div class="storage-bar-header">
              <span>STORAGE ${usedPct}%</span>
              <span>${formatBytes(node.storage_used)} / ${formatBytes(node.storage_total)}</span>
            </div>
            <div class="storage-track">
              <div class="storage-fill" style="width:${usedPct}%"></div>
            </div>
          </div>
        ` : `
          <div class="error-msg">
            <span>[ERR_FAIL]</span> ${node.last_error || 'CONNECTION_REFUSED'}
          </div>
          <div class="recovery-hint">
            Reed-Solomon RS(3,1) actively reconstructs missing shards via Galois Field GF(2^8) inversion.
          </div>
        `}
      </div>
    `;
  },

  renderStats(data) {
    setEl('stat-nodes', `${data.healthy_nodes} / ${data.total_nodes}`);
    setEl('stat-status', data.can_reconstruct ? 'QUORUM_OK' : 'DEGRADED');
    setEl('stat-summary', data.can_reconstruct
      ? `K=3 QUORUM READY (RS 3+1)`
      : `QUORUM COMPROMISED (< 3 NODES)`);
  },

  updateHeaderBadge(data) {
    const badge = document.getElementById('cluster-badge');
    if (!badge) return;
    const isOk = data.can_reconstruct;
    badge.innerHTML = `
      <span class="pulse-halo ${isOk ? 'online' : 'offline'}"></span>
      <span>${data.healthy_nodes}/${data.total_nodes} NODES ONLINE</span>
    `;
    badge.className = 'cluster-badge ' + (isOk ? 'badge-healthy' : 'badge-warn');
  },

  updateReconstructionPipeline(data) {
    const pipeline = document.getElementById('reconstruction-pipeline');
    if (!pipeline) return;

    if (data.healthy_nodes === 4) {
      pipeline.innerHTML = `
        <div class="reconstruct-status-group">
          <span class="reconstruct-badge">OPTIMAL QUORUM</span>
          <span class="reconstruct-text">All 4 nodes online. Direct zero-overhead parallel shard streaming active.</span>
        </div>
        <div class="reconstruct-math">FORMULA: D0 ⊕ D1 ⊕ D2 = P3 • GF(2^8)</div>
      `;
    } else if (data.can_reconstruct) {
      const deadNode = data.nodes.findIndex(n => !n.healthy);
      pipeline.innerHTML = `
        <div class="reconstruct-status-group">
          <span class="reconstruct-badge degraded">RS REPAIR READY</span>
          <span class="reconstruct-text">Node ${deadNode} offline (25% loss). Surviving 3 shards mathematically sufficient for 100% reconstruction.</span>
        </div>
        <div class="reconstruct-math" style="color:var(--hw-amber);">ON-DEMAND MATRIX INVERSION ACTIVE</div>
      `;
    } else {
      pipeline.innerHTML = `
        <div class="reconstruct-status-group">
          <span class="reconstruct-badge" style="background:var(--hw-crimson-dim);color:var(--hw-crimson);border-color:var(--hw-crimson-border);">DATA LOSS THRESHOLD</span>
          <span class="reconstruct-text">Fewer than 3 nodes available. Reed-Solomon RS(3,1) requires minimum 3 shards to decode.</span>
        </div>
        <div class="reconstruct-math" style="color:var(--hw-crimson);">CRITICAL INCIDENT</div>
      `;
    }
  },

  renderOffline() {
    const grid = document.getElementById('node-grid');
    if (grid) {
      grid.innerHTML = `
        <div class="empty-msg" style="grid-column:1/-1;">
          <div style="font-weight:700;font-size:0.95rem;color:var(--hw-crimson);margin-bottom:4px;">[ERR_COORDINATOR_OFFLINE]</div>
          <div>Cannot establish gRPC or HTTP link to coordinator on port 8080.</div>
        </div>`;
    }
    const badge = document.getElementById('cluster-badge');
    if (badge) {
      badge.innerHTML = `<span class="pulse-halo offline"></span><span>COORDINATOR OFFLINE</span>`;
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
