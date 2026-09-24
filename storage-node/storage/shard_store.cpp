#include "shard_store.h"
#include <fstream>
#include <filesystem>
#include <iostream>
#include <sstream>

namespace fs = std::filesystem;

// ─── Constructor ─────────────────────────────────────────────
ShardStore::ShardStore(const std::string& data_dir)
    : data_dir_(data_dir)
{
    fs::create_directories(data_dir_);

    // Scan existing files on startup to rebuild the in-memory index.
    for (const auto& entry : fs::directory_iterator(data_dir_)) {
        if (entry.is_regular_file()) {
            const std::string key = entry.path().stem().string();
            ShardInfo info;
            info.filepath   = entry.path().string();
            info.size_bytes = static_cast<size_t>(entry.file_size());
            info.is_parity  = false;
            index_[key]     = info;
            used_bytes_    += static_cast<int64_t>(info.size_bytes);
        }
    }

    std::cout << "[ShardStore] Loaded " << index_.size()
              << " existing shards from " << data_dir_ << "\n";
}

// ─── Store ───────────────────────────────────────────────────
bool ShardStore::Store(
    const std::string& file_id,
    int   shard_index,
    const std::string& data,
    const std::string& checksum,
    bool  is_parity)
{
    const std::string key      = MakeKey(file_id, shard_index);
    const std::string filepath = MakePath(key);

    // Write shard to disk atomically via temp-file swap.
    const std::string tmp_path = filepath + ".tmp";
    {
        std::ofstream ofs(tmp_path, std::ios::binary | std::ios::trunc);
        if (!ofs.is_open()) {
            std::cerr << "[ShardStore] Cannot open for writing: " << tmp_path << "\n";
            return false;
        }
        ofs.write(data.c_str(), static_cast<std::streamsize>(data.size()));
        if (!ofs.good()) {
            std::cerr << "[ShardStore] Write failed for: " << key << "\n";
            return false;
        }
    }
    fs::rename(tmp_path, filepath); // atomic on POSIX

    // Update in-memory index.
    std::unique_lock lock(mutex_);
    auto it = index_.find(key);
    if (it != index_.end()) {
        used_bytes_ -= static_cast<int64_t>(it->second.size_bytes);
    }

    ShardInfo info;
    info.filepath   = filepath;
    info.size_bytes = data.size();
    info.is_parity  = is_parity;
    info.checksum   = checksum;
    index_[key]     = info;
    used_bytes_    += static_cast<int64_t>(data.size());

    std::cout << "[ShardStore] Stored shard: " << key
              << " (" << data.size() << " bytes)\n";
    return true;
}

// ─── Retrieve ────────────────────────────────────────────────
bool ShardStore::Retrieve(
    const std::string& file_id,
    int   shard_index,
    std::string* out_data) const
{
    const std::string key = MakeKey(file_id, shard_index);

    std::shared_lock lock(mutex_);
    const auto it = index_.find(key);
    if (it == index_.end()) {
        std::cout << "[ShardStore] Shard not found: " << key << "\n";
        return false;
    }

    std::ifstream ifs(it->second.filepath, std::ios::binary);
    if (!ifs.is_open()) {
        std::cerr << "[ShardStore] Cannot open: " << it->second.filepath << "\n";
        return false;
    }

    *out_data = std::string(
        std::istreambuf_iterator<char>(ifs),
        std::istreambuf_iterator<char>()
    );

    std::cout << "[ShardStore] Retrieved shard: " << key
              << " (" << out_data->size() << " bytes)\n";
    return true;
}

// ─── Delete ──────────────────────────────────────────────────
bool ShardStore::Delete(const std::string& file_id, int shard_index)
{
    const std::string key = MakeKey(file_id, shard_index);

    std::unique_lock lock(mutex_);
    auto it = index_.find(key);
    if (it == index_.end()) return false;

    std::error_code ec;
    fs::remove(it->second.filepath, ec);
    used_bytes_ -= static_cast<int64_t>(it->second.size_bytes);
    index_.erase(it);
    return !ec;
}

// ─── Exists ──────────────────────────────────────────────────
bool ShardStore::Exists(const std::string& file_id, int shard_index) const
{
    const std::string key = MakeKey(file_id, shard_index);
    std::shared_lock lock(mutex_);
    return index_.count(key) > 0;
}

// ─── Stats ───────────────────────────────────────────────────
int64_t ShardStore::GetUsedBytes() const  { return used_bytes_.load(); }
int64_t ShardStore::GetShardCount() const {
    std::shared_lock lock(mutex_);
    return static_cast<int64_t>(index_.size());
}

// ─── Helpers ─────────────────────────────────────────────────
std::string ShardStore::MakeKey(const std::string& file_id, int index)
{
    return file_id + "_shard_" + std::to_string(index);
}

std::string ShardStore::MakePath(const std::string& key) const
{
    return data_dir_ + "/" + key + ".bin";
}
