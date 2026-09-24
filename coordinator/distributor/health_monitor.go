// Package distributor provides health monitoring for storage nodes.
package distributor

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"dfs/grpcclient"
)

// NodeStatus holds the current observed state of a single storage node.
type NodeStatus struct {
	NodeID       string        `json:"node_id"`
	Index        int           `json:"index"`
	Address      string        `json:"address"`
	Healthy      bool          `json:"healthy"`
	StorageUsed  int64         `json:"storage_used"`
	StorageTotal int64         `json:"storage_total"`
	ShardCount   int32         `json:"shard_count"`
	UptimeSecs   int64         `json:"uptime_seconds"`
	Latency      time.Duration `json:"latency_ms"`
	LastChecked  time.Time     `json:"last_checked"`
	LastError    string        `json:"last_error,omitempty"`
}

// HealthMonitor continuously checks all storage nodes every 5 seconds.
type HealthMonitor struct {
	nodes    []*grpcclient.NodeClient
	statuses []NodeStatus
	killed   map[int]bool
	mu       sync.RWMutex
	interval time.Duration
}

// NewHealthMonitor initialises the monitor for the given node clients.
func NewHealthMonitor(nodes []*grpcclient.NodeClient) *HealthMonitor {
	statuses := make([]NodeStatus, len(nodes))
	for i, n := range nodes {
		statuses[i] = NodeStatus{
			NodeID:  n.NodeID,
			Index:   i,
			Address: n.Address,
			Healthy: false,
		}
	}
	return &HealthMonitor{
		nodes:    nodes,
		statuses: statuses,
		killed:   make(map[int]bool),
		interval: 5 * time.Second,
	}
}

// Start launches background health polling. Cancellable via ctx.
func (hm *HealthMonitor) Start(ctx context.Context) {
	hm.checkAll(ctx) // immediate first check

	go func() {
		ticker := time.NewTicker(hm.interval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				hm.checkAll(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()

	log.Printf("✅ Health monitor started — checking every %v", hm.interval)
}

// checkAll pings all nodes concurrently.
func (hm *HealthMonitor) checkAll(ctx context.Context) {
	var wg sync.WaitGroup
	for i, node := range hm.nodes {
		wg.Add(1)
		go func(idx int, n *grpcclient.NodeClient) {
			defer wg.Done()

			hm.mu.RLock()
			isKilled := hm.killed[idx]
			hm.mu.RUnlock()

			if isKilled {
				hm.mu.Lock()
				hm.statuses[idx].Healthy = false
				hm.statuses[idx].LastError = "Node offline (simulated failure)"
				hm.statuses[idx].LastChecked = time.Now()
				hm.mu.Unlock()
				return
			}

			start := time.Now()
			resp, err := n.HealthCheck(ctx)
			latency := time.Since(start)

			hm.mu.Lock()
			defer hm.mu.Unlock()

			// Re-check after RPC in case killed concurrently
			if hm.killed[idx] {
				hm.statuses[idx].Healthy = false
				hm.statuses[idx].LastError = "Node offline (simulated failure)"
				hm.statuses[idx].LastChecked = time.Now()
				return
			}

			prevHealthy := hm.statuses[idx].Healthy

			if err != nil {
				hm.statuses[idx].Healthy     = false
				hm.statuses[idx].LastError   = err.Error()
				hm.statuses[idx].LastChecked = time.Now()
				if prevHealthy {
					log.Printf("🔴 Node %d (%s) went DOWN: %v", idx, n.NodeID, err)
				}
			} else {
				hm.statuses[idx] = NodeStatus{
					NodeID:       resp.NodeId,
					Index:        idx,
					Address:      n.Address,
					Healthy:      true,
					StorageUsed:  resp.StorageUsed,
					StorageTotal: resp.StorageTotal,
					ShardCount:   resp.ShardCount,
					UptimeSecs:   resp.UptimeSeconds,
					Latency:      latency,
					LastChecked:  time.Now(),
					LastError:    "",
				}
				if !prevHealthy {
					log.Printf("🟢 Node %d (%s) came back UP", idx, n.NodeID)
				}
			}
		}(i, node)
	}
	wg.Wait()
}

// SimulateKill marks a node as offline for failure simulation.
func (hm *HealthMonitor) SimulateKill(idx int) error {
	hm.mu.Lock()
	defer hm.mu.Unlock()
	if idx < 0 || idx >= len(hm.nodes) {
		return fmt.Errorf("invalid node index: %d", idx)
	}
	hm.killed[idx] = true
	hm.statuses[idx].Healthy = false
	hm.statuses[idx].LastError = "Node offline (simulated failure)"
	hm.statuses[idx].LastChecked = time.Now()
	log.Printf("💀 Node %d (%s) marked OFFLINE via simulation", idx, hm.nodes[idx].NodeID)
	return nil
}

// SimulateRecoverAll clears all simulated failures.
func (hm *HealthMonitor) SimulateRecoverAll() {
	hm.mu.Lock()
	hm.killed = make(map[int]bool)
	hm.mu.Unlock()
	log.Println("🔄 All simulated node failures cleared — rechecking nodes")
	hm.checkAll(context.Background())
}

// IsKilled returns whether a node is currently simulated offline.
func (hm *HealthMonitor) IsKilled(idx int) bool {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	return hm.killed[idx]
}

// GetStatuses returns a snapshot of all node statuses.
func (hm *HealthMonitor) GetStatuses() []NodeStatus {
	hm.mu.RLock()
	defer hm.mu.RUnlock()

	result := make([]NodeStatus, len(hm.statuses))
	copy(result, hm.statuses)
	return result
}

// HealthyCount returns the number of currently healthy nodes.
func (hm *HealthMonitor) HealthyCount() int {
	hm.mu.RLock()
	defer hm.mu.RUnlock()
	count := 0
	for _, s := range hm.statuses {
		if s.Healthy {
			count++
		}
	}
	return count
}

// CanReconstruct returns true when enough nodes are alive to recover any file.
func (hm *HealthMonitor) CanReconstruct() bool {
	return hm.HealthyCount() >= 3 // need at least DataShards
}

// ClusterSummary returns a display-friendly one-liner about cluster health.
func (hm *HealthMonitor) ClusterSummary() string {
	healthy := hm.HealthyCount()
	total := len(hm.nodes)
	if healthy == total {
		return fmt.Sprintf("✅ All %d nodes healthy", total)
	}
	if hm.CanReconstruct() {
		return fmt.Sprintf("⚠️  Degraded: %d/%d nodes up (recoverable)", healthy, total)
	}
	return fmt.Sprintf("🔴 Critical: %d/%d nodes up (cannot recover)", healthy, total)
}
