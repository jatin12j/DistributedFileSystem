// Package api provides the REST HTTP handlers for the DFS coordinator.
package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"dfs/distributor"
	"dfs/metadata"
)

// Handler holds all service dependencies needed by REST endpoints.
type Handler struct {
	chunks *distributor.ChunkManager
	health *distributor.HealthMonitor
	meta   *metadata.Store
}

// NewHandler wires up the REST handler with its dependencies.
func NewHandler(
	chunks *distributor.ChunkManager,
	health *distributor.HealthMonitor,
	meta *metadata.Store,
) *Handler {
	return &Handler{chunks: chunks, health: health, meta: meta}
}

// ─────────────────────────────────────────────────────────────
// POST /api/upload
// ─────────────────────────────────────────────────────────────

// HandleUpload receives a multipart file, encodes it, and distributes shards.
func (h *Handler) HandleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		h.writeCORSHeaders(w)
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		h.writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if !h.health.CanReconstruct() {
		h.writeError(w, "cluster too degraded to accept uploads", http.StatusServiceUnavailable)
		return
	}

	// Enforce 100 MB limit.
	r.Body = http.MaxBytesReader(w, r.Body, 100<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		h.writeError(w, "file too large (max 100MB)", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		h.writeError(w, "missing 'file' field in form", http.StatusBadRequest)
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		h.writeError(w, "failed to read file", http.StatusInternalServerError)
		return
	}

	mimeType := http.DetectContentType(data)
	fileID := uuid.New().String()

	log.Printf("📤 Upload: %s (%d bytes) [%s]", header.Filename, len(data), mimeType)

	result, err := h.chunks.Upload(r.Context(), fileID, header.Filename, data, mimeType)
	if err != nil {
		log.Printf("❌ Upload failed: %v", err)
		h.writeError(w, fmt.Sprintf("upload failed: %v", err), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"success":        true,
		"file_id":        result.FileID,
		"file_name":      result.FileName,
		"original_size":  result.OriginalSize,
		"shard_size":     result.ShardSize,
		"data_shards":    result.DataShards,
		"parity_shards":  result.ParityShards,
		"upload_time_ms": result.UploadTime.Milliseconds(),
		"nodes_used":     result.NodesUsed,
		"message":        "File distributed successfully",
	})
}

// ─────────────────────────────────────────────────────────────
// GET /api/download/{fileID}
// ─────────────────────────────────────────────────────────────

// HandleDownload reconstructs and streams the original file to the client.
func (h *Handler) HandleDownload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		h.writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	fileID := strings.TrimPrefix(r.URL.Path, "/api/download/")
	if fileID == "" {
		h.writeError(w, "missing file ID", http.StatusBadRequest)
		return
	}

	log.Printf("📥 Download request: %s", fileID)
	start := time.Now()

	data, fileInfo, err := h.chunks.Download(r.Context(), fileID)
	if err != nil {
		log.Printf("❌ Download failed for %s: %v", fileID, err)
		h.writeError(w, fmt.Sprintf("download failed: %v", err), http.StatusInternalServerError)
		return
	}

	elapsed := time.Since(start)
	log.Printf("✅ Download complete: %s in %v", fileID, elapsed)

	cleanName := filepath.Base(fileInfo.FileName)
	w.Header().Set("Content-Type", fileInfo.MimeType)
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`,
			cleanName, url.PathEscape(fileInfo.FileName)))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.Header().Set("X-File-ID", fileID)
	w.Header().Set("X-Retrieval-Time-Ms", fmt.Sprintf("%d", elapsed.Milliseconds()))
	w.Header().Set("Access-Control-Expose-Headers", "X-Retrieval-Time-Ms, X-File-ID, Content-Disposition")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	w.Write(data) //nolint:errcheck
}

// ─────────────────────────────────────────────────────────────
// GET /api/cluster/status
// ─────────────────────────────────────────────────────────────

// HandleClusterStatus returns live health data for all 4 storage nodes.
func (h *Handler) HandleClusterStatus(w http.ResponseWriter, r *http.Request) {
	statuses := h.health.GetStatuses()

	nodeData := make([]map[string]interface{}, len(statuses))
	for i, s := range statuses {
		nodeData[i] = map[string]interface{}{
			"node_id":       s.NodeID,
			"index":         s.Index,
			"address":       s.Address,
			"healthy":       s.Healthy,
			"storage_used":  s.StorageUsed,
			"storage_total": s.StorageTotal,
			"shard_count":   s.ShardCount,
			"uptime_secs":   s.UptimeSecs,
			"latency_ms":    s.Latency.Milliseconds(),
			"last_checked":  s.LastChecked,
			"last_error":    s.LastError,
		}
	}

	h.writeJSON(w, map[string]interface{}{
		"healthy_nodes":   h.health.HealthyCount(),
		"total_nodes":     len(statuses),
		"can_reconstruct": h.health.CanReconstruct(),
		"summary":         h.health.ClusterSummary(),
		"nodes":           nodeData,
		"timestamp":       time.Now(),
	})
}

// ─────────────────────────────────────────────────────────────
// GET /api/files
// ─────────────────────────────────────────────────────────────

// HandleListFiles returns all files currently tracked in the metadata store.
func (h *Handler) HandleListFiles(w http.ResponseWriter, r *http.Request) {
	files := h.meta.ListAll()

	result := make([]map[string]interface{}, len(files))
	for i, f := range files {
		result[i] = map[string]interface{}{
			"file_id":       f.FileID,
			"file_name":     f.FileName,
			"original_size": f.OriginalSize,
			"mime_type":     f.MimeType,
			"created_at":    f.CreatedAt,
			"data_shards":   f.DataShards,
			"parity_shards": f.ParityShards,
		}
	}

	h.writeJSON(w, map[string]interface{}{
		"files": result,
		"count": len(result),
	})
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/files/{fileID}
// ─────────────────────────────────────────────────────────────

// HandleDeleteFile removes all shards and metadata for a file.
func (h *Handler) HandleDeleteFile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		h.writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	fileID := strings.TrimPrefix(r.URL.Path, "/api/files/")
	if fileID == "" {
		h.writeError(w, "missing file ID", http.StatusBadRequest)
		return
	}

	if err := h.chunks.DeleteFile(r.Context(), fileID); err != nil {
		h.writeError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("File %s deleted", fileID),
	})
}

// ─────────────────────────────────────────────────────────────
// GET /api/health
// ─────────────────────────────────────────────────────────────

// HandleHealth is a simple coordinator liveness probe.
func (h *Handler) HandleHealth(w http.ResponseWriter, r *http.Request) {
	h.writeJSON(w, map[string]interface{}{
		"status":    "ok",
		"service":   "dfs-coordinator",
		"timestamp": time.Now(),
	})
}

// ─────────────────────────────────────────────────────────────
// POST /api/admin/kill/{nodeIndex}
// ─────────────────────────────────────────────────────────────

// HandleKillNode simulates killing a storage node.
func (h *Handler) HandleKillNode(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		h.writeCORSHeaders(w)
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		h.writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	raw := strings.TrimPrefix(r.URL.Path, "/api/admin/kill/")
	var idx int
	if _, err := fmt.Sscanf(raw, "%d", &idx); err != nil {
		h.writeError(w, "invalid node index", http.StatusBadRequest)
		return
	}

	if err := h.health.SimulateKill(idx); err != nil {
		h.writeError(w, err.Error(), http.StatusBadRequest)
		return
	}

	h.writeJSON(w, map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Node %d killed", idx),
		"node":    idx,
	})
}

// ─────────────────────────────────────────────────────────────
// POST /api/admin/recover
// ─────────────────────────────────────────────────────────────

// HandleRecoverAll recovers all killed nodes from simulation.
func (h *Handler) HandleRecoverAll(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		h.writeCORSHeaders(w)
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		h.writeError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	h.health.SimulateRecoverAll()
	h.writeJSON(w, map[string]interface{}{
		"success": true,
		"message": "All nodes recovered",
	})
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

func (h *Handler) writeCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
}

func (h *Handler) writeJSON(w http.ResponseWriter, v interface{}) {
	h.writeCORSHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func (h *Handler) writeError(w http.ResponseWriter, msg string, code int) {
	h.writeCORSHeaders(w)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
		"success": false,
		"error":   msg,
		"code":    code,
	})
}
