// frontend/js/upload.js
// File upload — drag-and-drop + shard distribution visualiser

const sleep = ms => new Promise(r => setTimeout(r, ms));
window.sleep = sleep;

const Uploader = {
  uploadedFiles: [],   // in-memory list for the file table

  init() {
    const input = document.getElementById('file-input');
    if (input) {
      input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) this.upload(file);
        e.target.value = ''; // allow re-selecting same file
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
    Logger.info(`📤 Uploading "${file.name}" (${formatBytes(file.size)})`);
    this.showProgress(true, 0, 'Reading file & computing checksum…');
    this.clearResult();

    try {
      // Animate progress bar through phases
      const phases = [
        [20, 150, 'Computing Reed-Solomon 3+1 Galois field matrix…'],
        [45, 180, 'Encoding data shards & generating parity shard…'],
        [75, 200, 'Distributing shards in parallel across 4 storage nodes…'],
        [90, 150, 'Verifying quorum & acknowledging replication…'],
      ];
      for (const [pct, delay, label] of phases) {
        await sleep(delay);
        this.showProgress(true, pct, label);
      }

      const result = await API.uploadFile(file);
      this.showProgress(true, 100, 'Upload & distribution complete!');

      this.uploadedFiles.push({
        file_id:       result.file_id,
        file_name:     result.file_name,
        size:          result.original_size,
        shard_size:    result.shard_size,
        data_shards:   result.data_shards,
        parity_shards: result.parity_shards,
        uploaded:      new Date(),
      });

      Logger.success(
        `✅ "${result.file_name}" distributed — ${result.upload_time_ms}ms ` +
        `| ID: ${result.file_id.substring(0,8)}…`
      );

      this.showResult(result);
      this.animateShardFlow(result);
      FileList.render(this.uploadedFiles);

    } catch (err) {
      Logger.error(`❌ Upload failed: ${err.message}`);
      this.showError(err.message);
    } finally {
      setTimeout(() => this.showProgress(false, 0), 1200);
    }
  },

  showProgress(show, value, labelText) {
    const wrap = document.getElementById('progress-wrap');
    const fill = document.getElementById('progress-fill');
    const label = document.getElementById('progress-status-text');
    if (wrap) wrap.style.display = show ? 'block' : 'none';
    if (fill) fill.style.width = (value || 0) + '%';
    if (label && labelText) label.textContent = labelText;
  },

  clearResult() {
    const res = document.getElementById('upload-result');
    if (res) res.innerHTML = '';
    const flow = document.getElementById('shard-flow');
    if (flow) flow.style.display = 'none';
  },

  showResult(result) {
    const encodedName = encodeURIComponent(result.file_name);
    const res = document.getElementById('upload-result');
    if (!res) return;

    res.innerHTML = `
      <div class="result-box success-box">
        <div class="result-row" style="font-weight:700;font-size:1rem;color:#10B981;">
          <span class="result-icon">✅</span>
          <span>"${result.file_name}" successfully striped &amp; stored</span>
        </div>
        <div class="result-row">
          <span class="result-icon">🆔</span>
          <span>File ID: <code style="font-family:var(--font-mono);">${result.file_id}</code></span>
        </div>
        <div class="result-row">
          <span class="result-icon">⚡</span>
          <span>Latency: <strong>${result.upload_time_ms}ms</strong> &nbsp;·&nbsp; Shards: <strong>${result.data_shards} Data + ${result.parity_shards} Parity</strong> (${formatBytes(result.shard_size)} / node)</span>
        </div>
        <div style="margin-top:14px;display:flex;gap:10px;">
          <button class="btn btn-download" onclick="Downloader.download('${result.file_id}', decodeURIComponent('${encodedName}'))">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            Download "${result.file_name}"
          </button>
        </div>
      </div>`;
  },

  animateShardFlow(result) {
    const flow = document.getElementById('shard-flow');
    if (!flow) return;
    flow.style.display = 'flex';
    flow.innerHTML = `
      <div class="shard-box data" id="sf-0" style="opacity:0">
        <div class="shard-icon">💾</div>
        <div class="shard-label">Data Shard 0</div>
        <div class="shard-size">${formatBytes(result.shard_size)}</div>
        <div class="shard-node">Node 0 :50051</div>
      </div>
      <div class="shard-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
      </div>
      <div class="shard-box data" id="sf-1" style="opacity:0">
        <div class="shard-icon">💾</div>
        <div class="shard-label">Data Shard 1</div>
        <div class="shard-size">${formatBytes(result.shard_size)}</div>
        <div class="shard-node">Node 1 :50051</div>
      </div>
      <div class="shard-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
      </div>
      <div class="shard-box data" id="sf-2" style="opacity:0">
        <div class="shard-icon">💾</div>
        <div class="shard-label">Data Shard 2</div>
        <div class="shard-size">${formatBytes(result.shard_size)}</div>
        <div class="shard-node">Node 2 :50051</div>
      </div>
      <div class="shard-arrow">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
      </div>
      <div class="shard-box parity" id="sf-3" style="opacity:0">
        <div class="shard-icon">🛡️</div>
        <div class="shard-label">Parity Shard</div>
        <div class="shard-size">${formatBytes(result.shard_size)}</div>
        <div class="shard-node" style="color:var(--amber);">Node 3 :50051</div>
      </div>`;

    // Stagger the shard appearances
    [0, 1, 2, 3].forEach((i, idx) => {
      setTimeout(() => {
        const el = document.getElementById(`sf-${i}`);
        if (el) {
          el.style.transition = 'opacity 0.4s ease, transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)';
          el.style.transform  = 'translateY(-10px)';
          el.style.opacity    = '1';
          setTimeout(() => { el.style.transform = 'translateY(0)'; }, 50);
        }
      }, idx * 120);
    });
  },

  showError(msg) {
    const res = document.getElementById('upload-result');
    if (!res) return;
    res.innerHTML = `
      <div class="result-box error-box">
        <div class="result-row"><span class="result-icon">❌</span><strong>Upload Failed:</strong> ${msg}</div>
      </div>`;
  }
};
