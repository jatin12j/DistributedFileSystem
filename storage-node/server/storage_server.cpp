#include "storage_server.h"
#include <openssl/sha.h>
#include <sstream>
#include <iomanip>
#include <iostream>
#include <chrono>

// ─── Constructor ─────────────────────────────────────────────
StorageNodeServer::StorageNodeServer(
    const std::string& node_id,
    const std::string& data_dir)
    : node_id_(node_id)
    , store_(data_dir)
    , start_time_(std::chrono::steady_clock::now())
{
    std::cout << "===========================================\n";
    std::cout << " Storage Node: " << node_id_  << "\n";
    std::cout << " Data Dir:     " << data_dir   << "\n";
    std::cout << "===========================================\n";
}

// ─── StoreShard ──────────────────────────────────────────────
grpc::Status StorageNodeServer::StoreShard(
    grpc::ServerContext* /*ctx*/,
    const storage::StoreShardRequest* req,
    storage::StoreShardResponse* resp)
{
    std::cout << "[" << node_id_ << "] StoreShard: "
              << req->file_id()
              << " shard=" << req->shard_index()
              << " size="  << req->data().size() << "\n";

    // Verify checksum if provided.
    if (!req->checksum().empty()) {
        const std::string computed = ComputeSHA256(req->data());
        if (computed != req->checksum()) {
            resp->set_success(false);
            resp->set_message("Checksum mismatch — data corrupted in transit");
            return grpc::Status(grpc::StatusCode::DATA_LOSS, "checksum mismatch");
        }
    }

    const bool ok = store_.Store(
        req->file_id(),
        req->shard_index(),
        req->data(),
        req->checksum(),
        req->is_parity()
    );

    if (!ok) {
        resp->set_success(false);
        resp->set_message("Storage write failed");
        return grpc::Status(grpc::StatusCode::INTERNAL, "storage write failed");
    }

    const std::string shard_id =
        req->file_id() + "_" + std::to_string(req->shard_index());

    resp->set_success(true);
    resp->set_shard_id(shard_id);
    resp->set_message("Stored successfully");
    total_writes_++;
    return grpc::Status::OK;
}

// ─── RetrieveShard ───────────────────────────────────────────
grpc::Status StorageNodeServer::RetrieveShard(
    grpc::ServerContext* /*ctx*/,
    const storage::RetrieveShardRequest* req,
    storage::RetrieveShardResponse* resp)
{
    std::cout << "[" << node_id_ << "] RetrieveShard: "
              << req->file_id()
              << " shard=" << req->shard_index() << "\n";

    std::string data;
    const bool found = store_.Retrieve(req->file_id(), req->shard_index(), &data);

    resp->set_found(found);
    if (found) {
        resp->set_data(data);
        resp->set_checksum(ComputeSHA256(data));
        total_reads_++;
    }
    return grpc::Status::OK;
}

// ─── DeleteShard ─────────────────────────────────────────────
grpc::Status StorageNodeServer::DeleteShard(
    grpc::ServerContext* /*ctx*/,
    const storage::DeleteShardRequest* req,
    storage::DeleteShardResponse* resp)
{
    const bool ok = store_.Delete(req->file_id(), req->shard_index());
    resp->set_success(ok);
    return grpc::Status::OK;
}

// ─── HealthCheck ─────────────────────────────────────────────
grpc::Status StorageNodeServer::HealthCheck(
    grpc::ServerContext* /*ctx*/,
    const storage::HealthRequest* /*req*/,
    storage::HealthResponse* resp)
{
    const auto now    = std::chrono::steady_clock::now();
    const auto uptime = std::chrono::duration_cast<std::chrono::seconds>(
                            now - start_time_).count();

    resp->set_healthy(true);
    resp->set_node_id(node_id_);
    resp->set_storage_used(store_.GetUsedBytes());
    resp->set_storage_total(10LL * 1024 * 1024 * 1024); // 10 GiB simulated
    resp->set_uptime_seconds(uptime);
    resp->set_shard_count(static_cast<int32_t>(store_.GetShardCount()));
    return grpc::Status::OK;
}

// ─── GetStats ────────────────────────────────────────────────
grpc::Status StorageNodeServer::GetStats(
    grpc::ServerContext* /*ctx*/,
    const storage::StatsRequest* /*req*/,
    storage::StatsResponse* resp)
{
    resp->set_node_id(node_id_);
    resp->set_total_reads(total_reads_.load());
    resp->set_total_writes(total_writes_.load());
    resp->set_bytes_stored(store_.GetUsedBytes());
    resp->set_avg_latency(0.0);
    return grpc::Status::OK;
}

// ─── SHA-256 helper ──────────────────────────────────────────
std::string StorageNodeServer::ComputeSHA256(const std::string& data)
{
    unsigned char hash[SHA256_DIGEST_LENGTH];
    SHA256(
        reinterpret_cast<const unsigned char*>(data.c_str()),
        data.size(),
        hash
    );
    std::ostringstream oss;
    for (int i = 0; i < SHA256_DIGEST_LENGTH; ++i) {
        oss << std::hex << std::setw(2) << std::setfill('0')
            << static_cast<int>(hash[i]);
    }
    return oss.str();
}
