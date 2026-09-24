#pragma once
#include <string>
#include <unordered_map>
#include <shared_mutex>
#include <mutex>
#include <atomic>

/// Metadata for a stored shard.
struct ShardInfo {
    std::string filepath;
    size_t      size_bytes{0};
    bool        is_parity{false};
    std::string checksum;
};

/// Thread-safe disk-backed shard store.
class ShardStore {
public:
    explicit ShardStore(const std::string& data_dir);

    /// Write shard bytes to disk and update the in-memory index.
    bool Store(
        const std::string& file_id,
        int shard_index,
        const std::string& data,
        const std::string& checksum,
        bool is_parity
    );

    /// Read shard bytes from disk into out_data.
    bool Retrieve(
        const std::string& file_id,
        int shard_index,
        std::string* out_data
    ) const;

    /// Remove a shard from disk and the index.
    bool Delete(
        const std::string& file_id,
        int shard_index
    );

    /// Check whether a shard exists in the index.
    bool Exists(
        const std::string& file_id,
        int shard_index
    ) const;

    /// Total bytes currently stored on this node.
    int64_t GetUsedBytes()  const;

    /// Number of shards currently stored.
    int64_t GetShardCount() const;

private:
    /// Build the index key from file_id + shard_index.
    static std::string MakeKey(const std::string& file_id, int index);

    /// Build the filesystem path for a key.
    std::string MakePath(const std::string& key) const;

    std::string data_dir_;
    std::unordered_map<std::string, ShardInfo> index_;
    mutable std::shared_mutex mutex_;
    std::atomic<int64_t> used_bytes_{0};
};
