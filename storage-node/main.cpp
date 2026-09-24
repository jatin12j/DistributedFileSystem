#include <grpcpp/grpcpp.h>
#include <iostream>
#include <string>
#include <csignal>
#include <memory>
#include "server/storage_server.h"

// Global server pointer for signal handling.
static std::unique_ptr<grpc::Server> g_server;

void HandleSignal(int sig) {
    std::cout << "\n[Node] Signal " << sig << " received — shutting down\n";
    if (g_server) {
        g_server->Shutdown();
    }
}

int main(int argc, char** argv) {
    // Usage: storage_node <node_id> <port> <data_dir>
    const std::string node_id  = (argc > 1) ? argv[1] : "node-0";
    const std::string port     = (argc > 2) ? argv[2] : "50051";
    const std::string data_dir = (argc > 3) ? argv[3] : "/data";

    std::signal(SIGTERM, HandleSignal);
    std::signal(SIGINT,  HandleSignal);

    StorageNodeServer service(node_id, data_dir);

    grpc::ServerBuilder builder;
    const std::string addr = "0.0.0.0:" + port;
    builder.AddListeningPort(addr, grpc::InsecureServerCredentials());
    builder.RegisterService(&service);

    // Allow large file shards (up to 256 MB).
    builder.SetMaxReceiveMessageSize(256 * 1024 * 1024);
    builder.SetMaxSendMessageSize(256 * 1024 * 1024);

    g_server = builder.BuildAndStart();
    std::cout << "[Node] " << node_id << " listening on " << addr << "\n";

    g_server->Wait();
    std::cout << "[Node] " << node_id << " stopped\n";
    return 0;
}
