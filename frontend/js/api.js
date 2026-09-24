// frontend/js/api.js
// ─────────────────────────────────────────────────────────────────────────────
// Centralized API layer.
//
// When the real Go coordinator at localhost:8080 is reachable → uses it.
// When it's unreachable (no Docker / no Go running) → falls back to
// MockBackend (mock_backend.js), which simulates the entire DFS cluster
// in the browser using localStorage and Web Crypto.
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:8080/api';

// Resolved once on first call, then cached for the session.
let _useMock = null;

async function isBackendReachable() {
  if (_useMock !== null) return !_useMock;
  try {
    const ctrl = new AbortController();
    const tid   = setTimeout(() => ctrl.abort(), 2000); // 2s probe
    const resp  = await fetch(`${BASE_URL}/health`, { signal: ctrl.signal });
    clearTimeout(tid);
    _useMock = !resp.ok;
  } catch {
    _useMock = true; // unreachable → use mock
  }
  if (_useMock) {
    console.warn('[API] Backend unreachable — running in Demo Mode (local simulation)');
  }
  return !_useMock;
}

// Force re-probe (useful if user starts the backend while page is open)
function resetBackendProbe() { _useMock = null; }

const API = {

  // Returns true when using the real backend, false when in demo mode
  async isLive() {
    return isBackendReachable();
  },

  // ── Upload a file ──────────────────────────────────────────────────────
  async uploadFile(file) {
    if (!(await isBackendReachable())) {
      return MockBackend.uploadFile(file);
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      let msg = 'Upload failed';
      try { const e = await response.json(); msg = e.error || msg; } catch {}
      throw new Error(msg);
    }
    return response.json();
  },

  // ── Download a file ────────────────────────────────────────────────────
  async downloadFile(fileID) {
    if (!(await isBackendReachable())) {
      const result = await MockBackend.downloadFile(fileID);
      if (result.reconstructed) {
        Logger.warn(`🔄 Reed-Solomon reconstruction used — one shard was missing!`);
      }
      return result;
    }

    const response = await fetch(`${BASE_URL}/download/${fileID}`);
    if (!response.ok) throw new Error('Download failed');

    const disposition   = response.headers.get('Content-Disposition') || '';
    const retrievalTime = response.headers.get('X-Retrieval-Time-Ms') || '?';

    // Support standard filename="..." and RFC 5987 filename*=UTF-8''...
    let fileName = '';
    const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    const stdMatch  = disposition.match(/filename="?([^";]+)"?/i);
    if (utf8Match) {
      try { fileName = decodeURIComponent(utf8Match[1]); } catch {}
    }
    if (!fileName && stdMatch) {
      fileName = stdMatch[1].trim();
    }
    if (!fileName) fileName = fileID;

    const blob = await response.blob();
    return { blob, fileName, retrievalTime };
  },

  // ── Cluster status ─────────────────────────────────────────────────────
  async getClusterStatus() {
    if (!(await isBackendReachable())) {
      return MockBackend.getClusterStatus();
    }
    const response = await fetch(`${BASE_URL}/cluster/status`);
    if (!response.ok) throw new Error('Cannot reach coordinator');
    return response.json();
  },

  // ── List files ─────────────────────────────────────────────────────────
  async getFiles() {
    if (!(await isBackendReachable())) {
      return MockBackend.getFiles();
    }
    const response = await fetch(`${BASE_URL}/files`);
    if (!response.ok) throw new Error('Cannot get file list');
    return response.json();
  },

  // ── Delete file ────────────────────────────────────────────────────────
  async deleteFile(fileID) {
    if (!(await isBackendReachable())) {
      return MockBackend.deleteFile(fileID);
    }
    const response = await fetch(`${BASE_URL}/files/${fileID}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Delete failed');
    return response.json();
  },
};
