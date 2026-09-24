// Package grpcclient provides gRPC client wrappers for storage node communication.
package grpcclient

import (
	"context"
	"fmt"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials/insecure"
	pb "dfs/proto"
)

// StoreRequest carries a shard to be stored on a node.
type StoreRequest struct {
	FileID       string
	ShardIndex   int
	Data         []byte
	Checksum     string
	IsParity     bool
	OriginalSize int64
}

// NodeClient wraps a gRPC connection to a single storage node.
type NodeClient struct {
	NodeID  string
	Address string
	conn    *grpc.ClientConn
	client  pb.StorageNodeClient
}

// NewNodeClient creates and connects to a storage node via gRPC.
func NewNodeClient(nodeID, address string) (*NodeClient, error) {
	opts := []grpc.DialOption{
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(256*1024*1024), // 256 MB
			grpc.MaxCallSendMsgSize(256*1024*1024),
		),
	}

	// grpc.Dial is non-blocking; connection established on first RPC.
	conn, err := grpc.Dial(address, opts...) //nolint:staticcheck
	if err != nil {
		return nil, fmt.Errorf("dial %s failed: %w", address, err)
	}

	return &NodeClient{
		NodeID:  nodeID,
		Address: address,
		conn:    conn,
		client:  pb.NewStorageNodeClient(conn),
	}, nil
}

// IsConnected reports whether the connection is not shut down.
func (n *NodeClient) IsConnected() bool {
	return n.conn.GetState() != connectivity.Shutdown
}

// StoreShard sends a shard to this node.
func (n *NodeClient) StoreShard(ctx context.Context, req *StoreRequest) error {
	timeoutCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	resp, err := n.client.StoreShard(timeoutCtx, &pb.StoreShardRequest{
		FileId:       req.FileID,
		ShardIndex:   int32(req.ShardIndex),
		Data:         req.Data,
		Checksum:     req.Checksum,
		IsParity:     req.IsParity,
		OriginalSize: req.OriginalSize,
	})
	if err != nil {
		return fmt.Errorf("gRPC StoreShard: %w", err)
	}
	if !resp.Success {
		return fmt.Errorf("node rejected shard: %s", resp.Message)
	}
	return nil
}

// RetrieveShard fetches a shard from this node.
func (n *NodeClient) RetrieveShard(ctx context.Context, fileID string, shardIndex int) ([]byte, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	resp, err := n.client.RetrieveShard(timeoutCtx, &pb.RetrieveShardRequest{
		FileId:     fileID,
		ShardIndex: int32(shardIndex),
	})
	if err != nil {
		return nil, fmt.Errorf("gRPC RetrieveShard: %w", err)
	}
	if !resp.Found {
		return nil, fmt.Errorf("shard not found on node %s", n.NodeID)
	}
	return resp.Data, nil
}

// HealthCheck pings the node and returns its status.
func (n *NodeClient) HealthCheck(ctx context.Context) (*pb.HealthResponse, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return n.client.HealthCheck(timeoutCtx, &pb.HealthRequest{})
}

// DeleteShard removes a shard from this node.
func (n *NodeClient) DeleteShard(ctx context.Context, fileID string, shardIndex int) error {
	timeoutCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	_, err := n.client.DeleteShard(timeoutCtx, &pb.DeleteShardRequest{
		FileId:     fileID,
		ShardIndex: int32(shardIndex),
	})
	return err
}

// Close tears down the gRPC connection.
func (n *NodeClient) Close() error {
	return n.conn.Close()
}
