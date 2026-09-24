# Distributed File Storage (DFS)

**Reed-Solomon Erasure Coding over a 4-node distributed storage cluster**

[![Go](https://img.shields.io/badge/Go-1.21-00ADD8?logo=go)](https://go.dev)
[![C++17](https://img.shields.io/badge/C++-17-00599C?logo=c%2B%2B)](https://isocpp.org)
[![gRPC](https://img.shields.io/badge/gRPC-1.62-4285F4?logo=google)](https://grpc.io)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://docker.com)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     BROWSER (Frontend)                          │
│              Plain HTML + JavaScript (port 3000)                │
│         Upload │ Download │ Dashboard │ Node Controls           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP REST (port 8080)
┌──────────────────────────▼──────────────────────────────────────┐
│                   GO COORDINATOR (Backend)                      │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐   │
│  │  REST API   │  │Reed-Solomon  │  │   Health Monitor    │   │
│  │  Handlers   │  │  3+1 Shards  │  │   (every 5s)        │   │
│  └─────────────┘  └──────────────┘  └─────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              gRPC Client Manager                        │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────┬──────────────┬──────────────┬──────────────┬──────────┘
         │ gRPC         │ gRPC         │ gRPC         │ gRPC
    port 50051     port 50052     port 50053     port 50054
┌────────▼────┐  ┌───────▼─────┐  ┌───────▼─────┐  ┌──────▼──────┐
│  C++ Node 0 │  │ C++ Node 1  │  │ C++ Node 2  │  │ C++ Node 3  │
│  Data Shard │  │ Data Shard  │  │ Data Shard  │  │Parity Shard │
│      0      │  │      1      │  │      2      │  │             │
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
```

## How Reed-Solomon Works Here

```
Original File (100 KB)
        │
        ▼  [RS Encode]
┌───────────────────────────────────────────────────────┐
│  Shard 0 (~34 KB)  │  Shard 1 (~34 KB)  │  Shard 2 (~34 KB)  │  Parity (~34 KB)  │
│      Node 0        │      Node 1         │      Node 2         │      Node 3        │
└───────────────────────────────────────────────────────┘
                              │
                   [Node 1 fails! 💀]
                              │
        ▼  [RS Reconstruct from 3 of 4 shards]
Shard 0 ✅ + Shard 2 ✅ + Parity ✅  →  reconstruct Shard 1  →  Original File ✅
```

- **3 data shards** split the file content evenly
- **1 parity shard** computed via Galois Field mathematics
- **Any 3 of 4 shards** are sufficient to fully reconstruct the file
- SHA-256 checksums verified at every store/retrieve step

---

## Project Structure

```
dfs-project/
├── coordinator/                   ← Go service
│   ├── main.go                    ← Entry point & wiring
│   ├── go.mod / go.sum
│   ├── api/
│   │   └── handler.go             ← REST handlers (upload/download/status)
│   ├── erasure/
│   │   └── encoder.go             ← Reed-Solomon encode/decode
│   ├── distributor/
│   │   ├── chunk_manager.go       ← Upload/download orchestration
│   │   └── health_monitor.go      ← Node health polling (5s interval)
│   ├── grpcclient/
│   │   └── node_client.go         ← gRPC client for storage nodes
│   ├── metadata/
│   │   └── store.go               ← In-memory file metadata store
│   ├── proto/
│   │   └── storage_stub.go        ← gRPC types + JSON codec
│   └── Dockerfile
│
├── storage-node/                  ← C++ service
│   ├── main.cpp                   ← Entry point (node_id, port, data_dir)
│   ├── CMakeLists.txt
│   ├── server/
│   │   ├── storage_server.h/cpp   ← gRPC service implementation
│   └── storage/
│       ├── shard_store.h/cpp      ← Thread-safe disk I/O
│   └── Dockerfile
│
├── proto/
│   └── storage.proto              ← Shared gRPC contract
│
├── frontend/
│   ├── index.html                 ← Single-page dashboard
│   ├── css/style.css              ← Premium dark-mode UI
│   └── js/
│       ├── api.js                 ← Fetch wrapper
│       ├── dashboard.js           ← Node status cards + polling
│       ├── upload.js              ← Drag-and-drop + shard visualiser
│       └── logger.js              ← Activity log panel
│
├── docker-compose.yml             ← Run everything
└── scripts/
    ├── demo.sh                    ← Full fault-tolerance demo
    └── test.sh                    ← API smoke tests
```

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Docker Desktop | ≥ 24 | Run all services |
| `protoc` | ≥ 25 | *(optional)* Regenerate proto code |
| Go | ≥ 1.21 | *(optional)* Local dev |
| CMake + gRPC | ≥ 3.15 | *(optional)* Local C++ build |

> **Quickstart only needs Docker** — everything else is compiled inside containers.

---

## Quickstart

### 1. Clone & Build

```bash
git clone <repo>
cd dfs-project

# Build all images and start the cluster
docker-compose up --build
```

This starts:
- `storage-node-0..3` on gRPC ports 50051-50054
- `dfs-coordinator` on `localhost:8080`
- `dfs-frontend` (nginx) on `localhost:3000`

### 2. Open the Dashboard

```
http://localhost:3000
```

All 4 node cards should be **green** within a few seconds.

### 3. Upload a File

```bash
curl -F "file=@/path/to/any/file.pdf" http://localhost:8080/api/upload
```

Or drag-and-drop in the browser.

### 4. Run the Fault Tolerance Demo

```bash
./scripts/demo.sh
```

What it does:
1. Uploads a random binary file
2. Downloads and verifies SHA-256 hash ✅
3. Kills `storage-node-1`
4. Downloads again — RS reconstructs the missing shard ✅
5. Verifies hash still matches ✅
6. Restarts the node

### 5. Run Smoke Tests

```bash
./scripts/test.sh
```

---

## REST API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Coordinator liveness probe |
| `GET` | `/api/cluster/status` | All 4 nodes: health, storage, latency |
| `POST` | `/api/upload` | Upload file (multipart `file` field) |
| `GET` | `/api/download/{fileID}` | Download reconstructed file |
| `GET` | `/api/files` | List all uploaded files |
| `DELETE` | `/api/files/{fileID}` | Delete file from all nodes |

### Upload Response

```json
{
  "success": true,
  "file_id": "550e8400-e29b-41d4-a716-446655440000",
  "file_name": "report.pdf",
  "original_size": 204800,
  "shard_size": 68267,
  "data_shards": 3,
  "parity_shards": 1,
  "upload_time_ms": 42,
  "nodes_used": ["node-0", "node-1", "node-2", "node-3"]
}
```

### Cluster Status Response

```json
{
  "healthy_nodes": 4,
  "total_nodes": 4,
  "can_reconstruct": true,
  "summary": "✅ All 4 nodes healthy",
  "nodes": [
    {
      "node_id": "node-0",
      "healthy": true,
      "storage_used": 204800,
      "storage_total": 10737418240,
      "shard_count": 3,
      "uptime_secs": 1802,
      "latency_ms": 1
    }
  ]
}
```

---

## gRPC Service Contract

Defined in [`proto/storage.proto`](proto/storage.proto):

```protobuf
service StorageNode {
  rpc StoreShard    (StoreShardRequest)    returns (StoreShardResponse);
  rpc RetrieveShard (RetrieveShardRequest) returns (RetrieveShardResponse);
  rpc DeleteShard   (DeleteShardRequest)   returns (DeleteShardResponse);
  rpc HealthCheck   (HealthRequest)        returns (HealthResponse);
  rpc GetStats      (StatsRequest)         returns (StatsResponse);
}
```

### Regenerate gRPC Code (optional)

```bash
# Go (coordinator)
protoc \
  --go_out=coordinator/proto \
  --go-grpc_out=coordinator/proto \
  proto/storage.proto

# C++ (storage-node) — done automatically in Dockerfile
protoc \
  --cpp_out=storage-node/proto \
  --grpc_out=storage-node/proto \
  --plugin=protoc-gen-grpc=$(which grpc_cpp_plugin) \
  proto/storage.proto
```

---

## Configuration

All coordinator config via environment variables (with defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | REST API port |
| `NODE_0_ADDR` | `localhost:50051` | Node 0 gRPC address |
| `NODE_1_ADDR` | `localhost:50052` | Node 1 gRPC address |
| `NODE_2_ADDR` | `localhost:50053` | Node 2 gRPC address |
| `NODE_3_ADDR` | `localhost:50054` | Node 3 gRPC address |

Storage node config via CLI args: `./storage_node <node_id> <port> <data_dir>`

---

## Failure Scenarios

| Scenario | Nodes Down | Outcome |
|----------|-----------|---------|
| Normal | 0 | All files readable |
| Single failure | 1 (any) | **Fully recoverable** via RS parity |
| Double failure | 2 | **Unrecoverable** — only 2 shards available |
| Kill Node 3 (parity) | 1 | **Recoverable** — 3 data shards still sufficient |

> The cluster moves to **degraded** state with 1 node down — uploads still work (tolerates 1 node failure on write too).

---

## Local Development (without Docker)

### Coordinator

```bash
cd coordinator
go mod download
go run . \
  NODE_0_ADDR=localhost:50051 \
  NODE_1_ADDR=localhost:50052 \
  NODE_2_ADDR=localhost:50053 \
  NODE_3_ADDR=localhost:50054
```

### Storage Nodes

```bash
# Terminal 1-4 (run 4 instances)
cd storage-node
cmake -B build -S . && cmake --build build

./build/storage_node node-0 50051 /tmp/node0
./build/storage_node node-1 50052 /tmp/node1
./build/storage_node node-2 50053 /tmp/node2
./build/storage_node node-3 50054 /tmp/node3
```

### Frontend

```bash
# Just open the file — no server needed for basic testing
open frontend/index.html

# Or serve with Python
python3 -m http.server 3000 --directory frontend
```

---

## Tech Choices

| Choice | Reason |
|--------|--------|
| **Go** for coordinator | Excellent concurrency model (goroutines), fast gRPC client |
| **C++17** for storage nodes | Maximum I/O performance, zero-overhead abstractions |
| **Reed-Solomon (3+1)** | Industry standard; recovers from 1/4 = 25% data loss |
| **gRPC** for node comms | Efficient binary protocol, streaming support, strong typing |
| **SHA-256** per shard | Detect bit-rot and corruption during transit |
| **In-memory metadata** | Simple, fast — swap for etcd/Redis in production |
| **Plain HTML+JS frontend** | No build step, instantly editable, zero framework overhead |
