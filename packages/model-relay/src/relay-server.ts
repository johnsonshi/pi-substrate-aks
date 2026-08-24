import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { ActorTokenAuthorizer } from "@pisa/copilot-broker";
import { ACTOR_ID_PATTERN } from "@pisa/protocol";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  encodedRelayFrameLimit,
  isAllowedProxyRoute,
  isRelayProxyResponse,
  type RelayProxyRequest,
  type RelayProxyResponse,
} from "./proxy-protocol.js";

interface PendingRequest {
  resolve: (response: RelayProxyResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export interface RelayServerOptions {
  actorTokens: Readonly<Record<string, string>>;
  tunnelToken: string;
  jobProxy?: {
    clientToken: string;
    targets: Readonly<
      Record<
        string,
        {
          targetToken: string;
          targetUrl: URL;
        }
      >
    >;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    requestTimeoutMs?: number;
  };
  maxBodyBytes?: number;
  maxConcurrentRequests?: number;
  requestTimeoutMs?: number;
}

export class RelayServer {
  readonly #actorAuthorizer: ActorTokenAuthorizer;
  readonly #tunnelAuthorizer: ActorTokenAuthorizer;
  readonly #jobAuthorizer: ActorTokenAuthorizer | undefined;
  readonly #jobProxy:
    | {
        targets: ReadonlyMap<
          string,
          {
            targetUrl: URL;
            targetToken: string;
          }
        >;
        maxRequestBytes: number;
        maxResponseBytes: number;
        requestTimeoutMs: number;
      }
    | undefined;
  readonly #maxBodyBytes: number;
  readonly #maxConcurrentRequests: number;
  readonly #requestTimeoutMs: number;
  readonly #server: Server;
  readonly #webSocketServer: WebSocketServer;
  readonly #pending = new Map<string, PendingRequest>();
  #bridge: WebSocket | undefined;
  #activeRequests = 0;
  #activeJobs = 0;
  #lastBridgeFailure: string | undefined;

  constructor(options: RelayServerOptions) {
    this.#actorAuthorizer = new ActorTokenAuthorizer(options.actorTokens);
    this.#tunnelAuthorizer = new ActorTokenAuthorizer({
      "trusted-bridge": options.tunnelToken,
    });
    if (options.jobProxy === undefined) {
      this.#jobAuthorizer = undefined;
      this.#jobProxy = undefined;
    } else {
      const targets = new Map<
        string,
        {
          targetUrl: URL;
          targetToken: string;
        }
      >();
      for (const [actorId, target] of Object.entries(
        options.jobProxy.targets,
      )) {
        if (
          !ACTOR_ID_PATTERN.test(actorId) ||
          !(actorId in options.actorTokens)
        ) {
          throw new Error("Relay job target actor ID is invalid");
        }
        assertPrivateJobTarget(target.targetUrl);
        if (target.targetToken.length < 32) {
          throw new Error("Actor job token must contain at least 32 characters");
        }
        targets.set(actorId, {
          targetUrl: new URL(target.targetUrl),
          targetToken: target.targetToken,
        });
      }
      if (targets.size === 0) {
        throw new Error("Relay job proxy requires at least one target");
      }
      this.#jobAuthorizer = new ActorTokenAuthorizer({
        "trusted-job-client": options.jobProxy.clientToken,
      });
      this.#jobProxy = {
        targets,
        maxRequestBytes:
          options.jobProxy.maxRequestBytes ?? 12 * 1024 * 1024,
        maxResponseBytes:
          options.jobProxy.maxResponseBytes ?? 8 * 1024 * 1024,
        requestTimeoutMs:
          options.jobProxy.requestTimeoutMs ?? 11 * 60_000,
      };
    }
    this.#maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
    this.#maxConcurrentRequests = options.maxConcurrentRequests ?? 2;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 125_000;
    this.#webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: encodedRelayFrameLimit(this.#maxBodyBytes),
      perMessageDeflate: false,
    });
    this.#server = createServer((request, response) => {
      void this.#handleHttp(request, response);
    });
    this.#server.on("upgrade", (request, socket, head) => {
      let url: URL;
      try {
        url = new URL(request.url ?? "/", "http://relay.invalid");
      } catch {
        socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const authorized =
        url.pathname === "/v1/tunnel" &&
        this.#tunnelAuthorizer.authorize(request.headers.authorization) ===
          "trusted-bridge";
      if (!authorized || this.#bridge !== undefined) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      this.#webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.#acceptBridge(webSocket);
      });
    });
  }

  async listen(host = "127.0.0.1", port = 0): Promise<URL> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(port, host, () => {
        this.#server.off("error", reject);
        resolve();
      });
    });
    const address = this.#server.address() as AddressInfo;
    return new URL(`http://${host}:${address.port}`);
  }

  get bridgeConnected(): boolean {
    return this.#bridge?.readyState === WebSocket.OPEN;
  }

  get lastBridgeFailure(): string | undefined {
    return this.#lastBridgeFailure;
  }

  async close(): Promise<void> {
    this.#disconnectBridge(new Error("Relay is closing"));
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
    this.#webSocketServer.close();
  }

  #acceptBridge(webSocket: WebSocket): void {
    this.#lastBridgeFailure = undefined;
    this.#bridge = webSocket;
    webSocket.on("message", (data, isBinary) => {
      this.#handleBridgeMessage(data, isBinary);
    });
    webSocket.once("close", () => {
      if (this.#bridge === webSocket) {
        this.#disconnectBridge(new Error("Trusted bridge disconnected"));
      }
    });
    webSocket.once("error", () => {
      if (this.#bridge === webSocket) {
        this.#disconnectBridge(new Error("Trusted bridge failed"));
      }
    });
  }

  #handleBridgeMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.#disconnectBridge(new Error("Binary bridge message rejected"));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      this.#disconnectBridge(new Error("Malformed bridge message"));
      return;
    }
    if (!isRelayProxyResponse(parsed, this.#maxBodyBytes)) {
      this.#disconnectBridge(new Error("Invalid bridge response"));
      return;
    }
    const pending = this.#pending.get(parsed.id);
    if (pending === undefined) {
      this.#disconnectBridge(new Error("Unknown bridge response"));
      return;
    }
    clearTimeout(pending.timeout);
    this.#pending.delete(parsed.id);
    pending.resolve(parsed);
  }

  #disconnectBridge(error: Error): void {
    this.#lastBridgeFailure = error.message;
    const bridge = this.#bridge;
    this.#bridge = undefined;
    if (
      bridge !== undefined &&
      (bridge.readyState === WebSocket.OPEN ||
        bridge.readyState === WebSocket.CONNECTING)
    ) {
      bridge.terminate();
    }
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  async #handleHttp(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const requestId = randomUUID();
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("x-request-id", requestId);
    try {
      const url = new URL(request.url ?? "/", "http://relay.invalid");
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, {
          status: "ok",
          bridgeConnected: this.bridgeConnected,
          activeJobs: this.#activeJobs,
        });
        return;
      }

      if (request.method === "POST" && isJobProxyPath(url.pathname)) {
        await this.#handleJobProxy(request, response, url.pathname);
        return;
      }

      const actorId = this.#actorAuthorizer.authorize(
        request.headers.authorization,
      );
      if (actorId === undefined || !ACTOR_ID_PATTERN.test(actorId)) {
        throw new RelayHttpError(401, "unauthorized");
      }
      const method = request.method ?? "";
      if (!isAllowedProxyRoute(method, url.pathname)) {
        throw new RelayHttpError(404, "not_found");
      }
      if (!this.bridgeConnected) {
        throw new RelayHttpError(503, "relay_unavailable");
      }
      if (this.#activeRequests >= this.#maxConcurrentRequests) {
        throw new RelayHttpError(429, "concurrency_limit");
      }
      const body =
        method === "POST"
          ? await readBody(request, this.#maxBodyBytes)
          : undefined;
      this.#activeRequests += 1;
      try {
        const proxied = await this.#proxy({
          kind: "request",
          id: requestId,
          actorId,
          method: method as "POST" | "DELETE",
          path: url.pathname,
          ...(body === undefined ? {} : { body }),
        });
        if (proxied.body.length === 0) {
          response.statusCode = proxied.status;
          response.end();
        } else {
          response.statusCode = proxied.status;
          response.end(proxied.body);
        }
      } finally {
        this.#activeRequests -= 1;
      }
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const relayError =
        error instanceof RelayHttpError
          ? error
          : new RelayHttpError(502, "bridge_error");
      sendJson(response, relayError.status, {
        error: {
          code: relayError.code,
          message: "Relay request failed",
          requestId,
        },
      });
    }
  }

  async #handleJobProxy(
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const jobProxy = this.#jobProxy;
    if (
      jobProxy === undefined ||
      this.#jobAuthorizer?.authorize(request.headers.authorization) !==
        "trusted-job-client"
    ) {
      throw new RelayHttpError(401, "unauthorized");
    }
    const actorId = jobActorId(pathname, jobProxy.targets);
    if (actorId === undefined) {
      throw new RelayHttpError(404, "not_found");
    }
    const target = jobProxy.targets.get(actorId);
    if (target === undefined) {
      throw new RelayHttpError(404, "not_found");
    }
    const body = await readBody(request, jobProxy.maxRequestBytes);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("Actor job proxy timed out")),
      jobProxy.requestTimeoutMs,
    );
    this.#activeJobs += 1;
    try {
      const targetResponse = await fetch(target.targetUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${target.targetToken}`,
          "content-type": "application/json",
        },
        body,
        signal: controller.signal,
      });
      const targetBody = await readBoundedFetchResponse(
        targetResponse,
        jobProxy.maxResponseBytes,
      );
      response.statusCode = targetResponse.status;
      response.end(targetBody);
    } catch {
      throw new RelayHttpError(502, "job_proxy_error");
    } finally {
      clearTimeout(timeout);
      this.#activeJobs -= 1;
    }
  }

  #proxy(request: RelayProxyRequest): Promise<RelayProxyResponse> {
    const bridge = this.#bridge;
    if (bridge?.readyState !== WebSocket.OPEN) {
      throw new RelayHttpError(503, "relay_unavailable");
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(request.id);
        reject(new RelayHttpError(504, "bridge_timeout"));
      }, this.#requestTimeoutMs);
      this.#pending.set(request.id, { resolve, reject, timeout });
      bridge.send(JSON.stringify(request), (error) => {
        if (error instanceof Error) {
          clearTimeout(timeout);
          this.#pending.delete(request.id);
          reject(new RelayHttpError(502, "bridge_error"));
        }
      });
    });
  }
}

class RelayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new RelayHttpError(413, "body_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}

async function readBoundedFetchResponse(
  response: Response,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maxBytes
  ) {
    throw new Error("Actor response exceeds relay limit");
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length > maxBytes) {
    throw new Error("Actor response exceeds relay limit");
  }
  return body;
}

function isJobProxyPath(pathname: string): boolean {
  return (
    pathname === "/v1/actor/run" ||
    /^\/v1\/actor\/[^/]+\/run$/.test(pathname)
  );
}

function jobActorId(
  pathname: string,
  targets: ReadonlyMap<string, unknown>,
): string | undefined {
  if (pathname === "/v1/actor/run") {
    return targets.size === 1 ? targets.keys().next().value : undefined;
  }
  const match = /^\/v1\/actor\/([^/]+)\/run$/.exec(pathname);
  const actorId = match?.[1];
  return actorId !== undefined && ACTOR_ID_PATTERN.test(actorId)
    ? actorId
    : undefined;
}

function assertPrivateJobTarget(url: URL): void {
  const hostname = url.hostname.toLowerCase();
  const isLoopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(
    hostname,
  );
  if (
    url.protocol !== "http:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (!isLoopback && !hostname.endsWith(".svc.cluster.local"))
  ) {
    throw new Error("Actor job target must be loopback or cluster-local HTTP");
  }
}
