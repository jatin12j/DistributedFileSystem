# ── Build Stage ──────────────────────────────────────────────
FROM golang:alpine AS builder

WORKDIR /app

# Install git (needed by go mod for some deps)
RUN apk add --no-cache git ca-certificates

# Cache dependency downloads as a separate layer
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Copy source
COPY . .

# Build — CGO disabled for a fully static binary
RUN CGO_ENABLED=0 GOOS=linux \
    go build -ldflags="-s -w -extldflags=-static" \
    -o coordinator .

# ── Runtime Stage ────────────────────────────────────────────
FROM scratch

# Bring in CA certs for any TLS connections
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

WORKDIR /app
COPY --from=builder /app/coordinator .

# REST API port
EXPOSE 8080

ENTRYPOINT ["./coordinator"]
