import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { ACTOR_ID_PATTERN } from "@pisa/protocol";
import type {
  BrokerErrorResponse,
  BrokerHealthResponse,
  CreateModelSessionRequest,
  CreateModelSessionResponse,
  ModelMessageRequest,
  ModelMessageResponse,
} from "@pisa/protocol";
import type { ActorTokenAuthorizer } from "./actor-token-authorizer.js";
import type { ModelBackend } from "./model-backend.js";

interface BrokerSession {
  actorId: string;
  backendSessionId: string;
}

export interface BrokerServerOptions {
  backend: ModelBackend;
  authorizer: ActorTokenAuthorizer;
  maxBodyBytes?: number;
  maxConcurrentRequests?: number;
  maxMessageCharacters?: number;
  requestTimeoutMs?: number;
}

export class BrokerServer {
  readonly #backend: ModelBackend;
  readonly #authorizer: ActorTokenAuthorizer;
  readonly #maxBodyBytes: number;
  readonly #maxConcurrentRequests: number;
  readonly #maxMessageCharacters: number;
  readonly #requestTimeoutMs: number;
  readonly #sessions = new Map<string, BrokerSession>();
  readonly #server: Server;
  #activeRequests = 0;

  constructor(options: BrokerServerOptions) {
    this.#backend = options.backend;
    this.#authorizer = options.authorizer;
    this.#maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
    this.#maxConcurrentRequests = options.maxConcurrentRequests ?? 2;
    this.#maxMessageCharacters = options.maxMessageCharacters ?? 32_000;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.#server = createServer((request, response) => {
      void this.#handle(request, response);
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

  async close(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
    await Promise.allSettled(
      [...this.#sessions.values()].map(async ({ backendSessionId }) =>
        this.#backend.deleteSession(backendSessionId),
      ),
    );
    this.#sessions.clear();
    await this.#backend.close();
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestId = randomUUID();
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("x-request-id", requestId);

    try {
      const url = new URL(request.url ?? "/", "http://broker.invalid");
      if (request.method === "GET" && url.pathname === "/healthz") {
        const body: BrokerHealthResponse = {
          status: "ok",
          backend: this.#backend.name,
        };
        sendJson(response, 200, body);
        return;
      }

      const actorId = this.#authorizer.authorize(request.headers.authorization);
      if (actorId === undefined || !ACTOR_ID_PATTERN.test(actorId)) {
        throw new HttpError(401, "unauthorized", "Actor authentication failed");
      }

      if (request.method === "POST" && url.pathname === "/v1/session") {
        const body = await readJson<CreateModelSessionRequest>(
          request,
          this.#maxBodyBytes,
        );
        if (
          !isRecord(body) ||
          (body.model !== undefined &&
            (typeof body.model !== "string" || !isModelName(body.model)))
        ) {
          throw new HttpError(400, "invalid_model", "Model name is invalid");
        }
        const backendSessionId = await this.#backend.createSession({
          actorId,
          ...(body.model === undefined ? {} : { model: body.model }),
        });
        const sessionId = randomUUID();
        this.#sessions.set(sessionId, { actorId, backendSessionId });
        const result: CreateModelSessionResponse = { sessionId };
        sendJson(response, 201, result);
        return;
      }

      const match = /^\/v1\/session\/([0-9a-f-]+)(?:\/messages)?$/.exec(
        url.pathname,
      );
      if (match === null || match[1] === undefined) {
        throw new HttpError(404, "not_found", "Route not found");
      }

      const sessionId = match[1];
      const session = this.#sessions.get(sessionId);
      if (session === undefined) {
        throw new HttpError(404, "session_not_found", "Session not found");
      }
      if (session.actorId !== actorId) {
        throw new HttpError(403, "actor_mismatch", "Session belongs to another actor");
      }

      if (request.method === "DELETE" && url.pathname.endsWith(sessionId)) {
        this.#sessions.delete(sessionId);
        await this.#backend.deleteSession(session.backendSessionId);
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === "POST" && url.pathname.endsWith("/messages")) {
        if (this.#activeRequests >= this.#maxConcurrentRequests) {
          throw new HttpError(429, "concurrency_limit", "Broker is at capacity");
        }
        const body = await readJson<ModelMessageRequest>(
          request,
          this.#maxBodyBytes,
        );
        if (
          !isRecord(body) ||
          typeof body.content !== "string" ||
          body.content.length === 0 ||
          body.content.length > this.#maxMessageCharacters
        ) {
          throw new HttpError(
            400,
            "invalid_message",
            `Message must contain 1-${this.#maxMessageCharacters} characters`,
          );
        }

        this.#activeRequests += 1;
        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(new Error("Model request timed out")),
          this.#requestTimeoutMs,
        );
        try {
          let content: string;
          try {
            content = await this.#backend.sendMessage({
              sessionId: session.backendSessionId,
              content: body.content,
              signal: controller.signal,
            });
          } catch (error) {
            if (controller.signal.aborted) {
              throw new HttpError(504, "request_timeout", "Model request timed out");
            }
            throw error;
          }
          const result: ModelMessageResponse = { requestId, content };
          sendJson(response, 200, result);
        } finally {
          clearTimeout(timeout);
          this.#activeRequests -= 1;
        }
        return;
      }

      throw new HttpError(405, "method_not_allowed", "Method not allowed");
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const httpError =
        error instanceof HttpError
          ? error
          : new HttpError(502, "backend_error", "Model backend request failed");
      const body: BrokerErrorResponse = {
        error: {
          code: httpError.code,
          message: httpError.message,
          requestId,
        },
      };
      sendJson(response, httpError.status, body);
    }
  }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<T>(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<T> {
  const contentType = request.headers["content-type"];
  if (contentType?.split(";", 1)[0]?.trim() !== "application/json") {
    throw new HttpError(415, "unsupported_media_type", "Expected application/json");
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  let exceeded = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBodyBytes) {
      exceeded = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (exceeded) {
    throw new HttpError(413, "request_too_large", "Request body is too large");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function isModelName(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.end(JSON.stringify(body));
}
