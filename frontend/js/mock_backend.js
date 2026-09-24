// frontend/js/mock_backend.js
// ─────────────────────────────────────────────────────────────────────────────
// Full in-browser simulation of the DFS backend.
// Activated automatically when the real API at localhost:8080 is unreachable.
//
// What it does:
//   • Splits files into 3 data + 1 parity chunks (byte-level Reed-Solomon simulation)
//   • Stores shards in memory (fast, handles any file size without quota crashes)
//   • Reconstructs files from any 3 of 4 shards (simulates RS recovery)
//   • Simulates node failures so the UI demo works end-to-end
//   • Returns exactly the same JSON shape as the real Go coordinator
// ─────────────────────────────────────────────────────────────────────────────

const MockBackend = (() => {

  // ── State ─────────────────────────────────────────────────────────────────

  const NODE_COUNT   = 4;
  const DATA_SHARDS  = 3;

  // In-memory binary shard cache (key -> Uint8Array)
  const memoryShards = new Map();

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

  // Persist file metadata in localStorage
  function getMeta() {
    try { return JSON.parse(localStorage.getItem('dfs_meta') || '{}'); }
    catch { return {}; }
  }
  function saveMeta(m) {
    try { localStorage.setItem('dfs_meta', JSON.stringify(m)); }
    catch (e) { console.warn('Metadata save error:', e); }
  }

  function getLocalShards() {
    try { return JSON.parse(localStorage.getItem('dfs_shards') || '{}'); }
    catch { return {}; }
  }
  function saveLocalShards(s) {
    try { localStorage.setItem('dfs_shards', JSON.stringify(s)); }
    catch (e) { console.warn('LocalStorage quota limit reached — using in-memory store for shards.'); }
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
    try {
      const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
      const hashArr = Array.from(new Uint8Array(hashBuf));
      return hashArr.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return 'hash-' + Math.random().toString(36).slice(2, 10);
    }
  }

  // Fast chunked base64 conversion (prevents stack overflow on large buffers)
  function toB64(arr) {
    let bin = '';
    const chunk = 8192;
    for (let i = 0; i < arr.length; i += chunk) {
      bin += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function fromB64(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // Simulate latency
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Public API — mirrors real Go coordinator REST responses ───────────────

  async function uploadFile(file) {
    const startTime = Date.now();
    const fileId    = (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'fid-' + Math.random().toString(36).substring(2);
    const mimeType  = file.type || 'application/octet-stream';

    const buffer   = await file.arrayBuffer();
    const { data, parity, shardSize, totalLen } = encode(buffer);

    // Compute checksums
    const allShards = [...data, parity];
    const checksums = await Promise.all(allShards.map(s => sha256(s)));

    const nodesUsed  = [];
    const localStore = getLocalShards();

    for (let i = 0; i < NODE_COUNT; i++) {
      if (!nodeState[i].online) continue; // skip dead nodes
      const key = `${fileId}_${i}`;

      // Save in fast memory cache
      memoryShards.set(key, allShards[i]);

      // If shard is reasonably sized, attempt local persistence
      if (allShards[i].length < 256 * 1024) {
        try { localStore[key] = toB64(allShards[i]); } catch {}
      }

      nodeState[i].writes++;
      nodeState[i].latency = Math.floor(Math.random() * 5) + 1;
      nodesUsed.push(nodeState[i].id);
    }

    saveLocalShards(localStore);

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

    await delay(150 + Math.random() * 100);

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
      message:        'File distributed successfully (In-Browser Simulation)',
    };
  }

  async function downloadFile(fileId) {
    const meta = getMeta()[fileId];
    if (!meta) throw new Error('File not found in storage');

    const localStore = getLocalShards();
    const allShards  = [];
    let   missingIdx = -1;

    for (let i = 0; i < NODE_COUNT; i++) {
      const key = `${fileId}_${i}`;
      if (!nodeState[i].online) {
        allShards.push(null);
        if (missingIdx === -1) missingIdx = i;
      } else if (memoryShards.has(key)) {
        allShards.push(memoryShards.get(key));
        nodeState[i].reads++;
      } else if (localStore[key]) {
        try {
          const arr = fromB64(localStore[key]);
          memoryShards.set(key, arr);
          allShards.push(arr);
          nodeState[i].reads++;
        } catch {
          allShards.push(null);
          if (missingIdx === -1) missingIdx = i;
        }
      } else {
        allShards.push(null);
        if (missingIdx === -1) missingIdx = i;
      }
    }

    const available = allShards.filter(Boolean).length;
    if (available < DATA_SHARDS) {
      throw new Error(`Quorum lost: only ${available}/4 nodes online (need at least 3 for Reed-Solomon reconstruction)`);
    }

    await delay(100 + Math.random() * 100);

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
      retrievalTime: Math.floor(Math.random() * 20) + 5,
      reconstructed: missingIdx !== -1,
    };
  }

  async function getClusterStatus() {
    nodeState.forEach(n => { if (n.online) n.uptime++; });

    const nodes = nodeState.map((n, i) => ({
      node_id:       n.id,
      index:         i,
      address:       `storage-node-${i}:50051`,
      healthy:       n.online,
      storage_used:  estimateStorageUsed(i),
      storage_total: 10 * 1024 * 1024 * 1024,
      shard_count:   countShards(i),
      uptime_secs:   n.uptime,
      latency_ms:    n.online ? n.latency : 0,
      last_checked:  new Date().toISOString(),
      last_error:    n.online ? '' : 'Node offline (simulated crash)',
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
    };
  }

  function getFiles() {
    const meta = getMeta();
    return {
      files: Object.values(meta).map(f => ({
        file_id:       f.file_id,
        file_name:     f.file_name,
        original_size: f.original_size,
        data_shards:   f.data_shards,
        parity_shards: f.parity_shards,
        created_at:    f.created_at,
      })),
      total: Object.keys(meta).length,
    };
  }

  function deleteFile(fileId) {
    const meta = getMeta();
    delete meta[fileId];
    saveMeta(meta);

    const localStore = getLocalShards();
    for (let i = 0; i < NODE_COUNT; i++) {
      const key = `${fileId}_${i}`;
      memoryShards.delete(key);
      delete localStore[key];
    }
    saveLocalShards(localStore);
    return { success: true };
  }

  function killNode(index) {
    if (index >= 0 && index < NODE_COUNT) {
      nodeState[index].online  = false;
      nodeState[index].latency = 0;
    }
  }

  function recoverAll() {
    nodeState.forEach(n => {
      n.online  = true;
      n.latency = Math.floor(Math.random() * 4) + 1;
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function estimateStorageUsed(nodeIdx) {
    const meta = getMeta();
    let total = 0;
    for (const f of Object.values(meta)) {
      total += f.shard_size || 0;
    }
    return total;
  }

  function countShards(nodeIdx) {
    return Object.keys(getMeta()).length;
  }

  function makeSummary(healthy, canRecon) {
    if (healthy === 4) return 'All 4 nodes healthy';
    if (canRecon)      return `${healthy}/4 nodes online — Reed-Solomon parity active`;
    return 'CRITICAL: Insufficient nodes for Reed-Solomon reconstruction';
  }

  return {
    uploadFile,
    downloadFile,
    getClusterStatus,
    getFiles,
    deleteFile,
    killNode,
    recoverAll,
  };
})();
