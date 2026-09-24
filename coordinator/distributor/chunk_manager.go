// Package distributor provides the core file distribution and retrieval logic.
package distributor

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"dfs/erasure"
	"dfs/grpcclient"
	"dfs/metadata"
)

// UploadResult is returned after a successful distributed upload.
type UploadResult struct {
	FileID       string        `json:"file_id"`
	FileName     string        `json:"file_name"`
	OriginalSize int64         `json:"original_size"`
	ShardSize    int           `json:"shard_size"`
	DataShards   int           `json:"data_shards"`
	ParityShards int           `json:"parity_shards"`
	UploadTime   time.Duration `json:"upload_time"`
	NodesUsed    []string      `json:"nodes_used"`
}

// ChunkManager orchestrates encoding, distribution, and retrieval of files.
type ChunkManager struct {
	encoder *erasure.Encoder
	nodes   []*grpcclient.NodeClient
	meta    *metadata.Store
	health  *HealthMonitor
}

// NewChunkManager creates a ChunkManager wired to the encoder, nodes, and meta store.
func NewChunkManager(
	encoder *erasure.Encoder,
	nodes []*grpcclient.NodeClient,
	meta *metadata.Store,
) *ChunkManager {
	return &ChunkManager{encoder: encoder, nodes: nodes, meta: meta}
}

// SetHealthMonitor links the health monitor so simulated node kills are honored.
func (cm *ChunkManager) SetHealthMonitor(hm *HealthMonitor) {
	cm.health = hm
}

// Upload encodes a file with Reed-Solomon and distributes shards across nodes.
func (cm *ChunkManager) Upload(
	ctx context.Context,
	fileID, fileName string,
	data []byte,
	mimeType string,
) (*UploadResult, error) {
	start := time.Now()
	log.Printf("📤 Starting upload: %s (%d bytes)", fileName, len(data))

	// ── Step 1: Encode ──────────────────────────────────────
	encoded, err := cm.encoder.Encode(fileID, data)
	if err != nil {
		return nil, fmt.Errorf("encoding failed: %w", err)
	}
	log.Printf("✂️  Split into %d shards of ~%d bytes each",
		erasure.TotalShards, encoded.ShardSize)

	// ── Step 2: Send all shards concurrently ────────────────
	type nodeResult struct {
		index int
		err   error
	}
	results := make(chan nodeResult, erasure.TotalShards)

	for i := 0; i < erasure.TotalShards; i++ {
		go func(shardIdx int) {
			if cm.health != nil && cm.health.IsKilled(shardIdx) {
				results <- nodeResult{index: shardIdx, err: fmt.Errorf("node %d simulated offline", shardIdx)}
				return
			}
			node := cm.nodes[shardIdx]
			err := node.StoreShard(ctx, &grpcclient.StoreRequest{
				FileID:       fileID,
				ShardIndex:   shardIdx,
				Data:         encoded.Shards[shardIdx],
				Checksum:     encoded.Checksums[shardIdx],
				IsParity:     shardIdx >= erasure.DataShards,
				OriginalSize: encoded.OriginalSize,
			})
			results <- nodeResult{index: shardIdx, err: err}
		}(i)
	}

	// ── Step 3: Collect results ──────────────────────────────
	nodeIDs := make([]string, erasure.TotalShards)
	failCount := 0
	for i := 0; i < erasure.TotalShards; i++ {
		r := <-results
		if r.err != nil {
			log.Printf("⚠️  Node %d failed: %v", r.index, r.err)
			failCount++
		} else {
			nodeIDs[r.index] = cm.nodes[r.index].NodeID
			log.Printf("✅ Shard %d stored on node %d", r.index, r.index)
		}
	}

	if failCount > erasure.ParityShards {
		return nil, fmt.Errorf(
			"too many node failures: %d failed (max tolerable: %d)",
			failCount, erasure.ParityShards,
		)
	}

	// ── Step 4: Persist metadata ─────────────────────────────
	cm.meta.Save(&metadata.FileInfo{
		FileID:       fileID,
		FileName:     fileName,
		OriginalSize: encoded.OriginalSize,
		TotalShards:  erasure.TotalShards,
		DataShards:   erasure.DataShards,
		ParityShards: erasure.ParityShards,
		Checksums:    encoded.Checksums,
		CreatedAt:    time.Now(),
		MimeType:     mimeType,
	})

	elapsed := time.Since(start)
	log.Printf("🎉 Upload complete: %s in %v", fileID, elapsed)

	return &UploadResult{
		FileID:       fileID,
		FileName:     fileName,
		OriginalSize: encoded.OriginalSize,
		ShardSize:    encoded.ShardSize,
		DataShards:   erasure.DataShards,
		ParityShards: erasure.ParityShards,
		UploadTime:   elapsed,
		NodesUsed:    nodeIDs,
	}, nil
}

// Download retrieves shards from nodes and reconstructs the original file.
func (cm *ChunkManager) Download(
	ctx context.Context,
	fileID string,
) ([]byte, *metadata.FileInfo, error) {
	start := time.Now()

	// ── Step 1: Look up metadata ─────────────────────────────
	fileInfo, err := cm.meta.Get(fileID)
	if err != nil {
		return nil, nil, fmt.Errorf("file not found: %w", err)
	}
	log.Printf("📥 Starting download: %s (%d bytes original)",
		fileInfo.FileName, fileInfo.OriginalSize)

	// ── Step 2: Fetch all shards concurrently ────────────────
	type shardResult struct {
		index int
		data  []byte
		err   error
	}
	results := make(chan shardResult, erasure.TotalShards)

	for i := 0; i < erasure.TotalShards; i++ {
		go func(shardIdx int) {
			if cm.health != nil && cm.health.IsKilled(shardIdx) {
				results <- shardResult{index: shardIdx, data: nil, err: fmt.Errorf("node %d simulated offline", shardIdx)}
				return
			}
			data, err := cm.nodes[shardIdx].RetrieveShard(ctx, fileID, shardIdx)
			results <- shardResult{index: shardIdx, data: data, err: err}
		}(i)
	}

	// ── Step 3: Collect available shards ────────────────────
	shards := make([][]byte, erasure.TotalShards)
	failedNodes := 0
	for i := 0; i < erasure.TotalShards; i++ {
		r := <-results
		if r.err != nil {
			log.Printf("⚠️  Node %d unavailable — will reconstruct via RS", r.index)
			shards[r.index] = nil // nil signals RS to reconstruct this shard
			failedNodes++
		} else {
			shards[r.index] = r.data
			log.Printf("✅ Got shard %d from node %d", r.index, r.index)
		}
	}

	// ── Step 4: Decode / Reconstruct ─────────────────────────
	log.Printf("🔄 Decoding: %d/%d shards available, reconstructing %d",
		erasure.TotalShards-failedNodes, erasure.TotalShards, failedNodes)

	data, err := cm.encoder.Decode(shards, fileInfo.OriginalSize)
	if err != nil {
		return nil, nil, fmt.Errorf("reconstruction failed: %w", err)
	}

	log.Printf("🎉 Download complete: %s in %v", fileID, time.Since(start))
	return data, fileInfo, nil
}

// DeleteFile removes all shards of a file from every node.
func (cm *ChunkManager) DeleteFile(ctx context.Context, fileID string) error {
	var wg sync.WaitGroup
	for i, node := range cm.nodes {
		wg.Add(1)
		go func(idx int, n *grpcclient.NodeClient) {
			defer wg.Done()
			if err := n.DeleteShard(ctx, fileID, idx); err != nil {
				log.Printf("⚠️  Delete shard %d failed: %v", idx, err)
			}
		}(i, node)
	}
	wg.Wait()
	cm.meta.Delete(fileID)
	return nil
}
