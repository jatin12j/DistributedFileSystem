// Package erasure provides Reed-Solomon erasure coding for file sharding.
package erasure

import (
	"crypto/sha256"
	"fmt"

	"github.com/klauspost/reedsolomon"
)

// Configuration constants.
const (
	DataShards   = 3 // 3 data pieces
	ParityShards = 1 // 1 parity piece
	TotalShards  = DataShards + ParityShards // 4 total
)

// EncodedResult holds all shards produced after encoding.
type EncodedResult struct {
	FileID       string
	Shards       [][]byte // length = TotalShards
	Checksums    []string // SHA256 per shard
	OriginalSize int64
	ShardSize    int
}

// Encoder handles Reed-Solomon encode/decode operations.
type Encoder struct {
	rs reedsolomon.Encoder
}

// NewEncoder creates a new RS encoder with 3 data + 1 parity shard.
func NewEncoder() (*Encoder, error) {
	rs, err := reedsolomon.New(DataShards, ParityShards)
	if err != nil {
		return nil, fmt.Errorf("RS init failed: %w", err)
	}
	return &Encoder{rs: rs}, nil
}

// Encode splits data into DataShards data + ParityShards parity shards.
func (e *Encoder) Encode(fileID string, data []byte) (*EncodedResult, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("cannot encode empty data")
	}

	originalSize := int64(len(data))

	// Split data into equal shards (library handles padding).
	shards, err := e.rs.Split(data)
	if err != nil {
		return nil, fmt.Errorf("split failed: %w", err)
	}

	// Calculate parity shards using Galois Field arithmetic.
	if err := e.rs.Encode(shards); err != nil {
		return nil, fmt.Errorf("encode failed: %w", err)
	}

	// Verify encoding correctness.
	ok, err := e.rs.Verify(shards)
	if err != nil || !ok {
		return nil, fmt.Errorf("encode verification failed")
	}

	// Compute SHA256 checksum for each shard.
	checksums := make([]string, TotalShards)
	for i, shard := range shards {
		hash := sha256.Sum256(shard)
		checksums[i] = fmt.Sprintf("%x", hash)
	}

	return &EncodedResult{
		FileID:       fileID,
		Shards:       shards,
		Checksums:    checksums,
		OriginalSize: originalSize,
		ShardSize:    len(shards[0]),
	}, nil
}

// Decode reconstructs original data from available shards.
// Pass nil for any missing or failed shards — RS will reconstruct them.
func (e *Encoder) Decode(shards [][]byte, originalSize int64) ([]byte, error) {
	if len(shards) != TotalShards {
		return nil, fmt.Errorf(
			"wrong shard count: got %d want %d",
			len(shards), TotalShards,
		)
	}

	// Count available shards.
	available := 0
	for _, s := range shards {
		if s != nil {
			available++
		}
	}

	if available < DataShards {
		return nil, fmt.Errorf(
			"not enough shards: have %d, need at least %d",
			available, DataShards,
		)
	}

	// Reconstruct any missing shards.
	if err := e.rs.Reconstruct(shards); err != nil {
		return nil, fmt.Errorf("reconstruction failed: %w", err)
	}

	// Verify reconstruction.
	ok, err := e.rs.Verify(shards)
	if err != nil || !ok {
		return nil, fmt.Errorf("verification failed after reconstruction")
	}

	// Join data shards only (ignore parity).
	var result []byte
	for i := 0; i < DataShards; i++ {
		result = append(result, shards[i]...)
	}

	// Remove padding — return exactly originalSize bytes.
	if int64(len(result)) < originalSize {
		return nil, fmt.Errorf("reconstruction produced fewer bytes than expected")
	}

	return result[:originalSize], nil
}
