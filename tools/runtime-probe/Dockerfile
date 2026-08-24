# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS build
ARG TARGETARCH
WORKDIR /src
COPY go.mod main.go ./
RUN CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
    go build -trimpath -ldflags="-s -w" -o /out/runtime-probe .

FROM scratch
COPY --from=build /out/runtime-probe /runtime-probe
USER 65532:65532
ENTRYPOINT ["/runtime-probe"]
