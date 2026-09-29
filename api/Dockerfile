# syntax=docker/dockerfile:1

ARG GO_VERSION=1.27
ARG AIR_VERSION=v1.67.4

# ---- base: module download layer shared by dev and build
FROM golang:${GO_VERSION}-alpine AS base
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

# ---- dev: hot reload with air (source is bind-mounted by compose)
FROM base AS dev
ARG AIR_VERSION
RUN go install github.com/air-verse/air@${AIR_VERSION}
COPY . .
EXPOSE 8080
CMD ["air", "-c", ".air.toml"]

# ---- build: static binary
FROM base AS build
COPY . .
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- prod: distroless, non-root
FROM gcr.io/distroless/static-debian12:nonroot AS prod
WORKDIR /app
COPY --from=build /out/server /app/server
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/server"]
