// frontend/js/upload.js
// Industrial Shard Distribution & Encoding Visualizer

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
    Logger.info(`[INGEST] Initiating upload for "${file.name}" (${formatBytes(file.size)})`);
    this.showProgress(true, 5, '[STAGE 1/4] Reading byte stream & hashing SHA-256…');
    this.clearResult();

    try {
      const phases = [
        [20, 180, '[STAGE 2/4] Generating Cauchy Galois Field GF(2^8) generator matrix…'],
        [45, 220, '[STAGE 3/4] Slicing 3 data shards & computing XOR parity shard…'],
        [75, 260, '[STAGE 4/4] Distributing shards in parallel across 4 gRPC nodes…'],
        [90, 160, '[COMMIT] Verifying quorum confirmation across cluster…'],
      ];
      for (const [pct, delay, label] of phases) {
        await sleep(delay);
        this.showProgress(true, pct, label);
      }

      const result = await API.uploadFile(file);
      this.showProgress(true, 100, '[COMMITTED] Quorum verified. All shards stored.');

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
        `[STRIPE_OK] "${result.file_name}" committed in ${result.upload_time_ms}ms ` +
        `| ID: ${result.file_id.substring(0,8)}…`
      );

      this.showResult(result);
      this.animateShardFlow(result);
      FileList.render(this.uploadedFiles);

    } catch (err) {
      Logger.error(`[UPLOAD_ERR] ${err.message}`);
      this.showError(err.message);
    } finally {
      setTimeout(() => this.showProgress(false, 0), 1600);
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
        <div class="result-row" style="font-weight:700;color:var(--hw-green);">
          <span class="result-tag">[STATUS: 200_OK]</span>
          <span>Object "${result.file_name}" striped across 4 nodes</span>
        </div>
        <div class="result-row">
          <span class="result-tag">OBJECT_ID</span>
          <code>${result.file_id}</code>
        </div>
        <div class="result-row">
          <span class="result-tag">TELEMETRY</span>
          <span>Latency: ${result.upload_time_ms}ms &nbsp;&bull;&nbsp; Layout: ${result.data_shards} Data + ${result.parity_shards} Parity (${formatBytes(result.shard_size)}/node)</span>
        </div>
        <div style="margin-top:12px;">
          <button class="btn btn-download" onclick="Downloader.download('${result.file_id}', decodeURIComponent('${encodedName}'))">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            RETRIEVE "${result.file_name}"
          </button>
        </div>
      </div>`;
  },

  animateShardFlow(result) {
    const flow = document.getElementById('shard-flow');
    if (!flow) return;
    flow.style.display = 'grid';
    flow.innerHTML = `
      <div class="shard-box data" id="sf-0" style="opacity:0">
        <div class="shard-top">
          <span class="shard-label">[SHARD_0] DATA</span>
          <span class="shard-size">${formatBytes(result.shard_size)}</span>
        </div>
        <div class="shard-node">NODE_0 :50051</div>
      </div>
      <div class="shard-box data" id="sf-1" style="opacity:0">
        <div class="shard-top">
          <span class="shard-label">[SHARD_1] DATA</span>
          <span class="shard-size">${formatBytes(result.shard_size)}</span>
        </div>
        <div class="shard-node">NODE_1 :50052</div>
      </div>
      <div class="shard-box data" id="sf-2" style="opacity:0">
        <div class="shard-top">
          <span class="shard-label">[SHARD_2] DATA</span>
          <span class="shard-size">${formatBytes(result.shard_size)}</span>
        </div>
        <div class="shard-node">NODE_2 :50053</div>
      </div>
      <div class="shard-box parity" id="sf-3" style="opacity:0">
        <div class="shard-top">
          <span class="shard-label">[PARITY] RS_GF8</span>
          <span class="shard-size">${formatBytes(result.shard_size)}</span>
        </div>
        <div class="shard-node" style="color:var(--hw-amber);">NODE_3 :50054</div>
      </div>`;

    [0, 1, 2, 3].forEach((i, idx) => {
      setTimeout(() => {
        const el = document.getElementById(`sf-${i}`);
        if (el) {
          el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
          el.style.transform  = 'translateY(-6px)';
          el.style.opacity    = '1';
          setTimeout(() => { el.style.transform = 'translateY(0)'; }, 40);
        }
      }, idx * 100);
    });
  },

  showError(msg) {
    const res = document.getElementById('upload-result');
    if (!res) return;
    res.innerHTML = `
      <div class="result-box error-box">
        <div class="result-row"><span class="result-tag">[ERR]</span><strong>UPLOAD_FAILED:</strong> ${msg}</div>
      </div>`;
  }
};
