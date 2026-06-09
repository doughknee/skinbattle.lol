# ── Build stage ──────────────────────────────────────────────────────────────
# Use a recent Go toolchain so dependencies that declare a newer `go` directive
# (e.g. go-oidc) build without GOTOOLCHAIN auto-download.
FROM golang:1.25 AS builder

WORKDIR /app

# Copy the full source first — `go mod tidy` needs the source to resolve imports
# (it would strip all requires if run against go.mod alone). This also generates
# go.sum at build time, so it isn't committed.
COPY . .
RUN go mod tidy

# Build a fully static binary. Migrations are embedded via embed.FS, so nothing
# else needs to be copied into the final image.
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -o /server ./cmd/server

# ── Final stage ───────────────────────────────────────────────────────────────
FROM gcr.io/distroless/static:nonroot

COPY --from=builder /server /server

EXPOSE 8080

ENTRYPOINT ["/server"]
