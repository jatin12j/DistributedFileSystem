// Package main is the entry point for the DFS coordinator service.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dfs/api"
	"dfs/distributor"
	"dfs/erasure"
	"dfs/grpcclient"
	"dfs/metadata"
)

func main() {
	log.Println("🚀 Starting DFS Coordinator")

	// ── Config from environment ──────────────────────────────
	nodeAddresses := []string{
		getEnv("NODE_0_ADDR", "localhost:50051"),
		getEnv("NODE_1_ADDR", "localhost:50052"),
		getEnv("NODE_2_ADDR", "localhost:50053"),
		getEnv("NODE_3_ADDR", "localhost:50054"),
	}
	port := getEnv("PORT", "8080")

	// ── Connect to storage nodes ─────────────────────────────
	nodes := make([]*grpcclient.NodeClient, len(nodeAddresses))
	for i, addr := range nodeAddresses {
		nodeID := fmt.Sprintf("node-%d", i)
		client, err := grpcclient.NewNodeClient(nodeID, addr)
		if err != nil {
			log.Fatalf("❌ Cannot connect to %s: %v", addr, err)
		}
		nodes[i] = client
		log.Printf("✅ Connected to node %d at %s", i, addr)
	}

	// ── Initialise components ────────────────────────────────
	encoder, err := erasure.NewEncoder()
	if err != nil {
		log.Fatalf("❌ RS encoder init failed: %v", err)
	}

	metaStore     := metadata.NewStore()
	chunkManager  := distributor.NewChunkManager(encoder, nodes, metaStore)
	healthMonitor := distributor.NewHealthMonitor(nodes)
	chunkManager.SetHealthMonitor(healthMonitor)

	// ── Start health monitoring ──────────────────────────────
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	healthMonitor.Start(ctx)

	// ── Setup REST routes ────────────────────────────────────
	handler := api.NewHandler(chunkManager, healthMonitor, metaStore)
	mux := http.NewServeMux()

	// CORS preflight for all routes.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.WriteHeader(http.StatusOK)
			return
		}
		// Serve frontend static files if present.
		http.ServeFile(w, r, "frontend/index.html")
	})

	mux.HandleFunc("/api/upload",         handler.HandleUpload)
	mux.HandleFunc("/api/download/",      handler.HandleDownload)
	mux.HandleFunc("/api/cluster/status", handler.HandleClusterStatus)
	mux.HandleFunc("/api/files",          handler.HandleListFiles)
	mux.HandleFunc("/api/files/",         handler.HandleDeleteFile)
	mux.HandleFunc("/api/health",         handler.HandleHealth)
	mux.HandleFunc("/api/admin/kill/",    handler.HandleKillNode)
	mux.HandleFunc("/api/admin/recover",  handler.HandleRecoverAll)

	// ── Start HTTP server ────────────────────────────────────
	server := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  5 * time.Minute,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}

	// Graceful shutdown on SIGTERM / SIGINT.
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
		<-sig
		log.Println("🛑 Shutting down coordinator...")
		cancel()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("⚠️  Shutdown error: %v", err)
		}
	}()

	log.Printf("✅ Coordinator listening on :%s", port)
	log.Printf("   Dashboard: http://localhost:%s", port)
	log.Printf("   API:       http://localhost:%s/api/health", port)

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("❌ Server error: %v", err)
	}

	log.Println("✅ Coordinator stopped cleanly")
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
