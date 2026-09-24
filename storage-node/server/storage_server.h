#pragma once
#include <grpcpp/grpcpp.h>
#include <atomic>
#include <chrono>
#include <string>
#include "storage.grpc.pb.h"
#include "../storage/shard_store.h"

/// gRPC service implementation for a single storage node.
class StorageNodeServer final
    : public storage::StorageNode::Service
{
public:
    StorageNodeServer(
        const std::string& node_id,
        const std::string& data_dir
    );

    // ── gRPC method overrides ─────────────────────────────────

    grpc::Status StoreShard(
        grpc::ServerContext* ctx,
        const storage::StoreShardRequest* req,
        storage::StoreShardResponse* resp) override;

    grpc::Status RetrieveShard(
        grpc::ServerContext* ctx,
        const storage::RetrieveShardRequest* req,
        storage::RetrieveShardResponse* resp) override;

    grpc::Status DeleteShard(
        grpc::ServerContext* ctx,
        const storage::DeleteShardRequest* req,
        storage::DeleteShardResponse* resp) override;

    grpc::Status HealthCheck(
        grpc::ServerContext* ctx,
        const storage::HealthRequest* req,
        storage::HealthResponse* resp) override;

    grpc::Status GetStats(
        grpc::ServerContext* ctx,
        const storage::StatsRequest* req,
        storage::StatsResponse* resp) override;

private:
    /// Compute hex-encoded SHA-256 of data.
    static std::string ComputeSHA256(const std::string& data);

    std::string  node_id_;
    ShardStore   store_;
    std::chrono::steady_clock::time_point start_time_;

    std::atomic<int64_t> total_reads_{0};
    std::atomic<int64_t> total_writes_{0};
};
