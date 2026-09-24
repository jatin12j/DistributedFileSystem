# ── Build Stage ──────────────────────────────────────────────
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

# Install build tools and gRPC/Protobuf dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    pkg-config \
    libssl-dev \
    libprotobuf-dev \
    protobuf-compiler \
    libgrpc++-dev \
    protobuf-compiler-grpc \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy source tree
COPY . .

# Generate protobuf / gRPC C++ code from proto
RUN mkdir -p proto && \
    (protoc --proto_path=proto --cpp_out=proto --grpc_out=proto --plugin=protoc-gen-grpc=/usr/bin/grpc_cpp_plugin proto/storage.proto 2>/dev/null || \
     protoc --proto_path=/app/../proto --cpp_out=proto --grpc_out=proto --plugin=protoc-gen-grpc=/usr/bin/grpc_cpp_plugin /app/../proto/storage.proto 2>/dev/null || \
     protoc --proto_path=/proto --cpp_out=proto --grpc_out=proto --plugin=protoc-gen-grpc=/usr/bin/grpc_cpp_plugin /proto/storage.proto)

# Build with CMake
RUN cmake -B build -S . -DCMAKE_BUILD_TYPE=Release && \
    cmake --build build --parallel $(nproc)

# ── Runtime Stage ────────────────────────────────────────────
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    libssl3 \
    libprotobuf23 \
    libgrpc++1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/build/storage_node .

# Default data directory
RUN mkdir -p /data
VOLUME ["/data"]

# Default gRPC port
EXPOSE 50051

ENTRYPOINT ["./storage_node"]
