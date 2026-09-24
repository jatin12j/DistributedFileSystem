// frontend/js/api.js
// ─────────────────────────────────────────────────────────────────────────────
// Centralized API layer.
//
// When the real Go coordinator is reachable (local Docker or remote cloud) → uses it.
// When it's unreachable (e.g. static Vercel deployment) → automatically
// falls back to MockBackend (mock_backend.js), which simulates the entire
// 4-node Reed-Solomon cluster in the browser using Web Crypto and localStorage.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_LOCAL_API = 'http://localhost:8080/api';
let BASE_URL = window.DFS_API_URL || localStorage.getItem('dfs_backend_url') || DEFAULT_LOCAL_API;

// Resolved once on first call, then cached for the session.
let _useMock = null;

async function isBackendReachable() {
  if (_useMock !== null) return !_useMock;

  // On HTTPS hosts (like Vercel), browsers block plain HTTP requests to localhost (Mixed Content)
  // unless a secure HTTPS backend URL is configured.
  const isHttpsHost = window.location.protocol === 'https:';
  const isPlainHttp = BASE_URL.startsWith('http://');

  if (isHttpsHost && isPlainHttp) {
    console.info('[API] Hosted on HTTPS without a secure remote backend — running in full In-Browser Simulation Mode.');
    _useMock = true;
    return false;
  }

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 1800); // 1.8s probe
    const resp = await fetch(`${BASE_URL}/health`, { signal: ctrl.signal });
    clearTimeout(tid);
    _useMock = !resp.ok;
  } catch {
    _useMock = true; // unreachable → use mock
  }

  if (_useMock) {
    console.warn('[API] Backend unreachable — running in Demo Mode (in-browser Reed-Solomon simulation)');
  }
  return !_useMock;
}

// Force re-probe (useful if user starts the backend or changes URL)
function resetBackendProbe() {
  _useMock = null;
}

function promptCustomBackend() {
  const current = localStorage.getItem('dfs_backend_url') || 'http://localhost:8080/api';
  const url = prompt('Enter your DistFS Coordinator API URL (e.g., https://my-cluster.onrender.com/api):', current);
  if (url !== null) {
    const trimmed = url.trim();
    if (trimmed) {
      localStorage.setItem('dfs_backend_url', trimmed);
      BASE_URL = trimmed;
    } else {
      localStorage.removeItem('dfs_backend_url');
      BASE_URL = DEFAULT_LOCAL_API;
    }
    resetBackendProbe();
    location.reload();
  }
}

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
        Logger.warn(`[RECONSTRUCT_INVOKED] Reed-Solomon RS(3,1) parity invoked — missing shard recovered bit-exact!`);
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
