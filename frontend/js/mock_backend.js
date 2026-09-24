// frontend/js/mock_backend.js
// ─────────────────────────────────────────────────────────────────────────────
// Full in-browser simulation of the DFS backend.
// Activated automatically when the real API at localhost:8080 is unreachable.
//
// What it does:
//   • Splits files into 3 data + 1 parity chunks (byte-level)
//   • Stores shards in localStorage (persists across page reload)
//   • Reconstructs files from any 3 of 4 shards (simulates RS recovery)
//   • Simulates node failures so the UI demo works end-to-end
//   • Returns exactly the same JSON shape as the real Go coordinator
// ─────────────────────────────────────────────────────────────────────────────

const MockBackend = (() => {

  // ── State ─────────────────────────────────────────────────────────────────

  const NODE_COUNT   = 4;
  const DATA_SHARDS  = 3;

  // Per-node simulated state
  const nodeState = Array.from({ length: NODE_COUNT }, (_, i) => ({
    id:      `node-${i}`,
    port:    50051 + i,
    online:  true,
    reads:   0,
    writes:  0,
    uptime:  Math.floor(Math.random() * 3600) + 60,
    latency: Math.floor(Math.random() * 4) + 1,
  }));

  // In-memory fallback in case localStorage quota is exceeded or unavailable
  let inMemoryMeta = {};
  let inMemoryShards = {};

  function getMeta() {
    try {
      const stored = localStorage.getItem('dfs_meta');
      return stored ? JSON.parse(stored) : inMemoryMeta;
    } catch {
      return inMemoryMeta;
    }
  }

  function saveMeta(m) {
    inMemoryMeta = m;
    try {
      localStorage.setItem('dfs_meta', JSON.stringify(m));
    } catch (e) {
      console.warn('[MockBackend] localStorage quota exceeded, keeping in memory', e);
    }
  }

  function getShards() {
    try {
      const stored = localStorage.getItem('dfs_shards');
      return stored ? JSON.parse(stored) : inMemoryShards;
    } catch {
      return inMemoryShards;
    }
  }

  function saveShards(s) {
    inMemoryShards = s;
    try {
      localStorage.setItem('dfs_shards', JSON.stringify(s));
    } catch (e) {
      console.warn('[MockBackend] localStorage quota exceeded, keeping in memory', e);
    }
  }

  // ── Reed-Solomon simulation (byte-level XOR parity) ───────────────────────

  // Split an ArrayBuffer into DATA_SHARDS equal-ish chunks + 1 XOR parity
  function encode(buffer) {
    const bytes     = new Uint8Array(buffer);
    const totalLen  = bytes.length;
    const shardSize = Math.ceil(totalLen / DATA_SHARDS);

    // Pad to multiple of DATA_SHARDS
    const padded = new Uint8Array(shardSize * DATA_SHARDS);
    padded.set(bytes);

    const data = [];
    for (let i = 0; i < DATA_SHARDS; i++) {
      data.push(padded.slice(i * shardSize, (i + 1) * shardSize));
    }

    // Parity = XOR of all data shards (simulates Galois Field computation)
    const parity = new Uint8Array(shardSize);
    for (let s = 0; s < DATA_SHARDS; s++) {
      for (let b = 0; b < shardSize; b++) {
        parity[b] ^= data[s][b];
      }
    }

    return { data, parity, shardSize, totalLen };
  }

  // Reconstruct original bytes from available shards (any 3 of 4)
  function decode(shards, shardSize, totalLen, missingIndex) {
    const data = shards.slice(0, DATA_SHARDS);

    if (missingIndex < DATA_SHARDS) {
      // Reconstruct missing data shard: XOR of the other 2 data shards + parity
      const recovered = new Uint8Array(shardSize);
      for (let i = 0; i < DATA_SHARDS; i++) {
        if (i === missingIndex) continue;
        for (let b = 0; b < shardSize; b++) {
          recovered[b] ^= data[i][b];
        }
      }
      const parity = shards[3];
      for (let b = 0; b < shardSize; b++) {
        recovered[b] ^= parity[b];
      }
      data[missingIndex] = recovered;
    }
    // If missingIndex === 3, parity is missing — we still have all 3 data shards, no reconstruction needed.

    // Concatenate data shards and trim padding
    const result = new Uint8Array(DATA_SHARDS * shardSize);
    for (let i = 0; i < DATA_SHARDS; i++) {
      result.set(data[i], i * shardSize);
    }
    return result.slice(0, totalLen);
  }

  // SHA-256 hex digest (async Web Crypto)
  async function sha256(bytes) {
    const hashBuf  = await crypto.subtle.digest('SHA-256', bytes);
    const hashArr  = Array.from(new Uint8Array(hashBuf));
    return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Convert Uint8Array → base64 string (for localStorage)
  function toB64(arr) {
    let bin = '';
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  // Convert base64 string → Uint8Array
  function fromB64(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // Simulate random latency
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Public API — mirrors real Go coordinator REST responses ───────────────

  async function uploadFile(file) {
    const startTime = Date.now();
    const fileId    = crypto.randomUUID();
    const mimeType  = file.type || 'application/octet-stream';

    const buffer   = await file.arrayBuffer();
    const { data, parity, shardSize, totalLen } = encode(buffer);

    // Compute checksums
    const allShards   = [...data, parity];
    const checksums   = await Promise.all(allShards.map(s => sha256(s)));

    // "Store" each shard on its simulated node
    const shardStore  = getShards();
    const nodesUsed   = [];

    for (let i = 0; i < NODE_COUNT; i++) {
      if (!nodeState[i].online) continue; // skip dead nodes
      const key = `${fileId}_${i}`;
      shardStore[key] = toB64(allShards[i]);
      nodeState[i].writes++;
      nodeState[i].latency = Math.floor(Math.random() * 5) + 1;
      nodesUsed.push(nodeState[i].id);
    }

    saveShards(shardStore);

    // Save metadata
    const meta = getMeta();
    meta[fileId] = {
      file_id:       fileId,
      file_name:     file.name,
      original_size: totalLen,
      shard_size:    shardSize,
      mime_type:     mimeType,
      checksums,
      data_shards:   DATA_SHARDS,
      parity_shards: 1,
      created_at:    new Date().toISOString(),
    };
    saveMeta(meta);

    await delay(300 + Math.random() * 200); // simulate network

    const uploadTime = Date.now() - startTime;
    return {
      success:        true,
      file_id:        fileId,
      file_name:      file.name,
      original_size:  totalLen,
      shard_size:     shardSize,
      data_shards:    DATA_SHARDS,
      parity_shards:  1,
      upload_time_ms: uploadTime,
      nodes_used:     nodesUsed,
      message:        'File distributed successfully (Demo Mode)',
    };
  }

  async function downloadFile(fileId) {
    const meta = getMeta()[fileId];
    if (!meta) throw new Error('File not found in demo storage');

    const shardStore = getShards();
    const allShards  = [];
    let   missingIdx = -1;

    for (let i = 0; i < NODE_COUNT; i++) {
      const key = `${fileId}_${i}`;
      if (!nodeState[i].online || !shardStore[key]) {
        allShards.push(null);
        if (missingIdx === -1) missingIdx = i;
      } else {
        allShards.push(fromB64(shardStore[key]));
        nodeState[i].reads++;
      }
    }

    const available = allShards.filter(Boolean).length;
    if (available < DATA_SHARDS) {
      throw new Error(`Not enough shards: only ${available}/4 nodes available (need 3)`);
    }

    await delay(200 + Math.random() * 150);

    const recovered = decode(
      allShards.map(s => s || new Uint8Array(meta.shard_size)),
      meta.shard_size,
      meta.original_size,
      missingIdx,
    );

    const blob = new Blob([recovered], { type: meta.mime_type });
    return {
      blob,
      fileName:     meta.file_name,
      retrievalTime: Math.floor(Math.random() * 30) + 5,
      reconstructed: missingIdx !== -1,
    };
  }

  async function getClusterStatus() {
    // Tick uptime
    nodeState.forEach(n => { if (n.online) n.uptime++; });

    const nodes = nodeState.map((n, i) => ({
      node_id:       n.id,
      index:         i,
      address:       `localhost:${n.port}`,
      healthy:       n.online,
      storage_used:  estimateStorageUsed(i),
      storage_total: 10 * 1024 * 1024 * 1024,
      shard_count:   countShards(i),
      uptime_secs:   n.uptime,
      latency_ms:    n.online ? n.latency : 0,
      last_checked:  new Date().toISOString(),
      last_error:    n.online ? '' : 'Connection refused (simulated failure)',
    }));

    const healthyCount = nodes.filter(n => n.healthy).length;
    const canReconstruct = healthyCount >= DATA_SHARDS;

    return {
      healthy_nodes:   healthyCount,
      total_nodes:     NODE_COUNT,
      can_reconstruct: canReconstruct,
      summary:         makeSummary(healthyCount, canReconstruct),
      nodes,
      timestamp:       new Date().toISOString(),
      demo_mode:       true,
    };
  }

  function getFiles() {
    const meta   = getMeta();
    const files  = Object.values(meta).map(f => ({
      file_id:       f.file_id,
      file_name:     f.file_name,
      original_size: f.original_size,
      mime_type:     f.mime_type,
      created_at:    f.created_at,
      data_shards:   f.data_shards,
      parity_shards: f.parity_shards,
    }));
    return { files, count: files.length };
  }

  function deleteFile(fileId) {
    const meta    = getMeta();
    const shards  = getShards();
    delete meta[fileId];
    for (let i = 0; i < NODE_COUNT; i++) delete shards[`${fileId}_${i}`];
    saveMeta(meta);
    saveShards(shards);
    return { success: true, message: `File ${fileId} deleted` };
  }

  // ── Node control (demo UI buttons) ────────────────────────────────────────

  function killNode(index) {
    if (index >= 0 && index < NODE_COUNT) {
      nodeState[index].online = false;
    }
  }

  function recoverAll() {
    nodeState.forEach(n => { n.online = true; });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function countShards(nodeIndex) {
    const shards = getShards();
    return Object.keys(shards).filter(k => k.endsWith(`_${nodeIndex}`)).length;
  }

  function estimateStorageUsed(nodeIndex) {
    const shards = getShards();
    let total = 0;
    for (const [k, v] of Object.entries(shards)) {
      if (k.endsWith(`_${nodeIndex}`)) total += v.length * 0.75; // base64 overhead
    }
    return Math.floor(total);
  }

  function makeSummary(healthy, canReconstruct) {
    if (healthy === NODE_COUNT) return `✅ All ${NODE_COUNT} nodes healthy`;
    if (canReconstruct) return `⚠️  Degraded: ${healthy}/${NODE_COUNT} nodes up (recoverable)`;
    return `🔴 Critical: ${healthy}/${NODE_COUNT} nodes up (cannot recover)`;
  }

  // ── Public interface ──────────────────────────────────────────────────────
  return { uploadFile, downloadFile, getClusterStatus, getFiles, deleteFile, killNode, recoverAll };

})();
