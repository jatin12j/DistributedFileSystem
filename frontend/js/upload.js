// frontend/js/upload.js
// File upload — drag-and-drop + shard distribution visualiser

const Uploader = {
  uploadedFiles: [],   // in-memory list for the file table

  init() {
    document.getElementById('file-input')
      .addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) this.upload(file);
        e.target.value = ''; // allow re-selecting same file
      });

    const zone = document.getElementById('drop-zone');
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
  },

  async upload(file) {
    Logger.info(`📤 Uploading "${file.name}" (${formatBytes(file.size)})`);
    this.showProgress(true, 0);
    this.clearResult();

    // Animate progress bar through phases
    const phases = [
      [10, 200],   // reading
      [30, 300],   // encoding
      [60, 400],   // distributing
      [85, 300],   // confirming
    ];
    for (const [pct, delay] of phases) {
      await sleep(delay);
      this.showProgress(true, pct);
    }

    try {
      const result = await API.uploadFile(file);
      this.showProgress(true, 100);

      this.uploadedFiles.push({
        file_id:      result.file_id,
        file_name:    result.file_name,
        size:         result.original_size,
        shard_size:   result.shard_size,
        data_shards:  result.data_shards,
        parity_shards:result.parity_shards,
        uploaded:     new Date(),
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
      setTimeout(() => this.showProgress(false, 0), 1800);
    }
  },

  showProgress(show, value) {
    const wrap = document.getElementById('progress-wrap');
    const bar  = document.getElementById('upload-progress');
    wrap.style.display = show ? 'block' : 'none';
    if (bar) bar.value = value;
  },

  clearResult() {
    document.getElementById('upload-result').innerHTML = '';
    document.getElementById('shard-flow').style.display = 'none';
  },

  showResult(result) {
    const encodedName = encodeURIComponent(result.file_name);
    document.getElementById('upload-result').innerHTML = `
      <div class="result-box success-box">
        <div class="result-row"><span class="result-icon">✅</span>
          <strong>${result.file_name}</strong> distributed across cluster</div>
        <div class="result-row"><span class="result-icon">🆔</span>
          <code>${result.file_id}</code></div>
        <div class="result-row"><span class="result-icon">⚡</span>
          ${result.upload_time_ms}ms upload time</div>
        <div class="result-row"><span class="result-icon">📦</span>
          ${result.data_shards} data + ${result.parity_shards} parity shards
          (${formatBytes(result.shard_size)} each)</div>
        <div style="margin-top:12px">
          <button class="btn btn-download" onclick="Downloader.download('${result.file_id}', decodeURIComponent('${encodedName}'))">
            ⬇️ Download "${result.file_name}"
          </button>
        </div>
      </div>`;
  },

  animateShardFlow(result) {
    const flow = document.getElementById('shard-flow');
    flow.style.display = 'flex';
    flow.innerHTML = `
      <div class="shard-box data" id="sf-0" style="opacity:0">
        <div class="shard-icon">💾</div>
        <div class="shard-label">Shard 0</div>
        <div class="shard-size">${formatBytes(result.shard_size)}</div>
        <div class="shard-node">Node 0</div>
      </div>
      <div class="shard-arrow">→</div>
      <div class="shard-box data" id="sf-1" style="opacity:0">
        <div class="shard-icon">💾</div>
        <div class="shard-label">Shard 1</div>
        <div class="shard-size">${formatBytes(result.shard_size)}</div>
        <div class="shard-node">Node 1</div>
      </div>
      <div class="shard-arrow">→</div>
      <div class="shard-box data" id="sf-2" style="opacity:0">
        <div class="shard-icon">💾</div>
        <div class="shard-label">Shard 2</div>
        <div class="shard-size">${formatBytes(result.shard_size)}</div>
        <div class="shard-node">Node 2</div>
      </div>
      <div class="shard-arrow">→</div>
      <div class="shard-box parity" id="sf-3" style="opacity:0">
        <div class="shard-icon">🛡️</div>
        <div class="shard-label">Parity</div>
        <div class="shard-size">${formatBytes(result.shard_size)}</div>
        <div class="shard-node">Node 3</div>
      </div>`;

    // Stagger the shard appearances
    [0, 1, 2, 3].forEach((i, idx) => {
      setTimeout(() => {
        const el = document.getElementById(`sf-${i}`);
        if (el) {
          el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
          el.style.transform  = 'translateY(-8px)';
          el.style.opacity    = '1';
          setTimeout(() => { el.style.transform = 'translateY(0)'; }, 50);
        }
      }, idx * 150);
    });
  },

  showError(msg) {
    document.getElementById('upload-result').innerHTML = `
      <div class="result-box error-box">
        <span class="result-icon">❌</span> ${msg}
      </div>`;
  },
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
