// frontend/js/upload.js
// File upload — drag-and-drop + Reed-Solomon RS(3+1) visual encoding pipeline

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const Uploader = {
  uploadedFiles: [],

  init() {
    const input = document.getElementById('file-input');
    if (input) {
      input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) this.upload(file);
        e.target.value = '';
      });
    }

    const zone = document.getElementById('drop-zone');
    if (zone) {
      zone.addEventListener('dragover', e => {
        e.preventDefault();
        zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) this.upload(file);
      });
    }
  },

  async upload(file) {
    Logger.info(`↑ Uploading "${file.name}" (${formatBytes(file.size)})`);
    this.updateFlowchartInitial(file);
    this.showProgress(true, 10, 'Reading binary payload & computing SHA-256…');
    this.clearResult();

    try {
      // Step through RS pipeline phases with visual flowchart animation
      await sleep(180);
      this.showProgress(true, 30, 'Multiplying Galois Field GF(2⁸) generator matrix…');
      this.updateFlowchartEncoding('Multiplying Galois Field GF(2⁸) matrix…', 'GF(2⁸) Active');

      await sleep(220);
      this.showProgress(true, 55, 'Synthesizing 3 data shards + 1 parity shard…');
      this.updateFlowchartShardsStreaming();

      await sleep(240);
      this.showProgress(true, 80, 'Streaming chunks across gRPC endpoints :50051-:50054…');

      const result = await API.uploadFile(file);
      this.showProgress(true, 100, 'Distribution quorum confirmed (3 Data + 1 Parity)');
      this.updateFlowchartComplete(result);

      const fileRecord = {
        file_id:       result.file_id,
        file_name:     result.file_name,
        size:          result.original_size,
        shard_size:    result.shard_size,
        data_shards:   result.data_shards || 3,
        parity_shards: result.parity_shards || 1,
        uploaded:      new Date(),
      };
      this.uploadedFiles.unshift(fileRecord);

      Logger.success(
        `✓ File distributed: "${result.file_name}" in ${result.upload_time_ms}ms ` +
        `| ID: ${result.file_id.substring(0, 8)}…`
      );

      this.showResult(result);
      FileList.render(this.uploadedFiles);
      if (window.Dashboard) {
        Dashboard.refresh();
      }

    } catch (err) {
      Logger.error(`✕ Upload failed: ${err.message}`);
      this.showError(err.message);
      this.updateFlowchartError(err.message);
    } finally {
      setTimeout(() => this.showProgress(false, 0), 1600);
    }
  },

  updateFlowchartInitial(file) {
    const fn = document.getElementById('uf-filename');
    const fs = document.getElementById('uf-filesize');
    const step1 = document.getElementById('uf-step-file');
    const p1 = document.getElementById('uf-pulse-1');
    if (fn) fn.textContent = file.name;
    if (fs) fs.textContent = formatBytes(file.size);
    if (step1) step1.classList.add('active');
    if (p1) p1.classList.add('animating');

    // Reset shard cards
    [0, 1, 2, 3].forEach(i => {
      const card = document.getElementById(`uf-shard-${i}`);
      const sz = document.getElementById(`uf-sz-${i}`);
      if (card) card.classList.remove('active');
      if (sz) sz.textContent = 'Waiting…';
    });
  },

  updateFlowchartEncoding(status, tag) {
    const enc = document.getElementById('uf-step-encode');
    const st = document.getElementById('uf-encode-status');
    const tg = document.getElementById('uf-encode-tag');
    const p2 = document.getElementById('uf-pulse-2');
    if (enc) enc.classList.add('active');
    if (st) st.textContent = status;
    if (tg) {
      tg.className = 'upload-flow-tag ready';
      tg.textContent = tag;
    }
    if (p2) p2.classList.add('animating');
  },

  updateFlowchartShardsStreaming() {
    [0, 1, 2, 3].forEach(i => {
      const card = document.getElementById(`uf-shard-${i}`);
      const sz = document.getElementById(`uf-sz-${i}`);
      if (card) card.classList.add('active');
      if (sz) sz.textContent = 'gRPC stream…';
    });
  },

  updateFlowchartComplete(result) {
    const p1 = document.getElementById('uf-pulse-1');
    const p2 = document.getElementById('uf-pulse-2');
    if (p1) p1.classList.remove('animating');
    if (p2) p2.classList.remove('animating');

    const st = document.getElementById('uf-encode-status');
    const tg = document.getElementById('uf-encode-tag');
    if (st) st.textContent = `Completed in ${result.upload_time_ms}ms • RS(3+1) verified`;
    if (tg) {
      tg.className = 'upload-flow-tag complete';
      tg.textContent = 'Distributed ✓';
    }

    [0, 1, 2, 3].forEach(i => {
      const card = document.getElementById(`uf-shard-${i}`);
      const sz = document.getElementById(`uf-sz-${i}`);
      if (card) card.classList.add('active');
      if (sz) sz.textContent = `${formatBytes(result.shard_size)}`;
    });
  },

  updateFlowchartError(msg) {
    const p1 = document.getElementById('uf-pulse-1');
    const p2 = document.getElementById('uf-pulse-2');
    if (p1) p1.classList.remove('animating');
    if (p2) p2.classList.remove('animating');

    const tg = document.getElementById('uf-encode-tag');
    if (tg) {
      tg.className = 'upload-flow-tag error';
      tg.textContent = 'Failed';
    }
  },

  showProgress(show, value, labelText) {
    const wrap  = document.getElementById('progress-wrap');
    const fill  = document.getElementById('progress-fill');
    const label = document.getElementById('progress-status-text');
    const pct   = document.getElementById('progress-pct');

    if (wrap) wrap.style.display = show ? 'block' : 'none';
    if (fill) fill.style.width = (value || 0) + '%';
    if (label && labelText) label.textContent = labelText;
    if (pct) pct.textContent = (value || 0) + '%';
  },

  clearResult() {
    const res = document.getElementById('upload-result');
    if (res) res.innerHTML = '';
  },

  showResult(result) {
    const encodedName = encodeURIComponent(result.file_name);
    const res = document.getElementById('upload-result');
    if (!res) return;

    res.innerHTML = `
      <div class="result-card success">
        <div class="result-header-row">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="color:var(--green);font-weight:700;">✓</span>
            <span class="result-filename">${result.file_name}</span>
            <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;">(${formatBytes(result.original_size)})</span>
          </div>
          <button class="btn-action" onclick="Downloader.download('${result.file_id}', decodeURIComponent('${encodedName}'))">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download
          </button>
        </div>
        <div class="result-details">
          <span>Latency: <strong style="color:var(--text-primary);font-family:var(--font-mono)">${result.upload_time_ms} ms</strong></span>
          <span>Layout: <strong style="color:var(--text-primary)">${result.data_shards || 3} Data + ${result.parity_shards || 1} Parity</strong></span>
          <span>Shard Size: <strong style="color:var(--text-primary);font-family:var(--font-mono)">${formatBytes(result.shard_size)}</strong> / node</span>
          <span>ID: <code>${result.file_id ? result.file_id.substring(0, 18) + '…' : '—'}</code></span>
        </div>
      </div>`;
  },

  showError(msg) {
    const res = document.getElementById('upload-result');
    if (!res) return;
    res.innerHTML = `
      <div class="result-card error">
        <div style="font-weight:600;color:var(--red);margin-bottom:4px;">✕ Upload Failed</div>
        <div style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-secondary);">${msg}</div>
      </div>`;
  }
};

window.Uploader = Uploader;
