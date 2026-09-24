// Package metadata provides a thread-safe in-memory store for file metadata.
package metadata

import (
	"fmt"
	"sync"
	"time"
)

// FileInfo stores everything about an uploaded file.
type FileInfo struct {
	FileID       string    `json:"file_id"`
	FileName     string    `json:"file_name"`
	OriginalSize int64     `json:"original_size"`
	TotalShards  int       `json:"total_shards"`
	DataShards   int       `json:"data_shards"`
	ParityShards int       `json:"parity_shards"`
	Checksums    []string  `json:"checksums"`
	CreatedAt    time.Time `json:"created_at"`
	MimeType     string    `json:"mime_type"`
}

// Store is a thread-safe in-memory metadata store.
type Store struct {
	mu    sync.RWMutex
	files map[string]*FileInfo
}

// NewStore creates a new metadata store.
func NewStore() *Store {
	return &Store{
		files: make(map[string]*FileInfo),
	}
}

// Save persists file metadata.
func (s *Store) Save(info *FileInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.files[info.FileID] = info
}

// Get retrieves file metadata by ID.
func (s *Store) Get(fileID string) (*FileInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	info, ok := s.files[fileID]
	if !ok {
		return nil, fmt.Errorf("file not found: %s", fileID)
	}
	return info, nil
}

// Delete removes a file's metadata.
func (s *Store) Delete(fileID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.files, fileID)
}

// ListAll returns all stored file metadata.
func (s *Store) ListAll() []*FileInfo {
	s.mu.RLock()
	defer s.mu.RUnlock()

	files := make([]*FileInfo, 0, len(s.files))
	for _, f := range s.files {
		files = append(files, f)
	}
	return files
}

// Count returns the number of files stored.
func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.files)
}
