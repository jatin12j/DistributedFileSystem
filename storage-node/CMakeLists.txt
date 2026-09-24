cmake_minimum_required(VERSION 3.15)
project(StorageNode CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Find dependencies ───────────────────────────────────────
find_package(Protobuf REQUIRED)
find_package(OpenSSL  REQUIRED)
find_package(PkgConfig REQUIRED)
pkg_check_modules(GRPC REQUIRED IMPORTED_TARGET grpc++)

# ── Proto-generated files ───────────────────────────────────
# Run from build directory:
#   protoc --cpp_out=. --grpc_out=. --plugin=protoc-gen-grpc=<grpc_cpp_plugin> ../../proto/storage.proto
set(PROTO_DIR "${CMAKE_SOURCE_DIR}/proto")
set(PROTO_SRCS "${PROTO_DIR}/storage.pb.cc")
set(GRPC_SRCS  "${PROTO_DIR}/storage.grpc.pb.cc")

# ── Executable ──────────────────────────────────────────────
add_executable(storage_node
    main.cpp
    server/storage_server.cpp
    storage/shard_store.cpp
    ${PROTO_SRCS}
    ${GRPC_SRCS}
)

target_include_directories(storage_node
    PRIVATE
        ${CMAKE_SOURCE_DIR}
        ${PROTO_DIR}
        ${Protobuf_INCLUDE_DIRS}
)

target_link_libraries(storage_node
    PRIVATE
        PkgConfig::GRPC
        protobuf::libprotobuf
        OpenSSL::Crypto
)

# ── Compiler warnings ────────────────────────────────────────
target_compile_options(storage_node PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:-Wall -Wextra -Wpedantic>
)
