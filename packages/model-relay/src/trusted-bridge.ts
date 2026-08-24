import type { IncomingHttpHeaders } from "node:http";
import WebSocket, { type RawData } from "ws";
import {
  encodedRelayFrameLimit,
  isRelayProxyRequest,
  type RelayProxyRequest,
  type RelayProxyResponse,
} from "./proxy-protocol.js";

export interface TrustedBridgeOptions {
  relayUrl: URL;
  tunnelToken: string;
  brokerUrl: URL;
  actorTokens: Readonly<Record<string, string>>;
  maxBodyBytes?: number;
}

export class TrustedBridge {
  readonly #options: TrustedBridgeOptions;
  readonly #maxBodyBytes: number;
  #socket: WebSocket | undefined;

  constructor(options: TrustedBridgeOptions) {
    assertLoopbackUrl(options.relayUrl, ["ws:", "wss:"]);
    assertLoopbackUrl(options.brokerUrl, ["http:", "https:"]);
    if (Object.keys(options.actorTokens).length === 0) {
      throw new Error("Trusted bridge requires at least one actor token");
    }
    this.#options = options;
    this.#maxBodyBytes = options.maxBodyBytes ?? 64 * 1024;
  }

  async connect(): Promise<void> {
    if (this.#socket !== undefined) {
      throw new Error("Trusted bridge is already connected");
    }
    const socket = new WebSocket(this.#options.relayUrl, {
      headers: {
        authorization: `Bearer ${this.#options.tunnelToken}`,
      } satisfies IncomingHttpHeaders,
      maxPayload: encodedRelayFrameLimit(this.#maxBodyBytes),
      perMessageDeflate: false,
    });
    this.#socket = socket;
    socket.on("message", (data, isBinary) => {
      void this.#handleMessage(data, isBinary).catch(() => {
        socket.terminate();
      });
    });
    socket.on("close", () => {
      if (this.#socket === socket) {
        this.#socket = undefined;
      }
    });
    socket.on("error", () => {
      if (this.#socket === socket) {
        this.#socket = undefined;
        socket.terminate();
      }
    });
    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        socket.off("error", onError);
        resolve();
      };
      const onError = (): void => {
        socket.off("open", onOpen);
        reject(new Error("Trusted bridge connection failed"));
      };
      socket.once("open", onOpen);
      socket.once("error", onError);
    });
  }

  async close(): Promise<void> {
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket === undefined || socket.readyState === WebSocket.CLOSED) {
      return;
    }
    await new Promise<void>((resolve) => {
      let closed = false;
      const finish = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        socket.terminate();
        finish();
      }, 5_000);
      socket.once("close", finish);
      socket.close(1000, "bridge closing");
    });
  }

  async #handleMessage(data: RawData, isBinary: boolean): Promise<void> {
    const socket = this.#socket;
    if (socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    if (isBinary) {
      socket.terminate();
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      socket.terminate();
      return;
    }
    if (!isRelayProxyRequest(parsed, this.#maxBodyBytes)) {
      socket.terminate();
      return;
    }
    const response = await this.#forward(parsed);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(response), (error) => {
        if (error instanceof Error) {
          socket.terminate();
        }
      });
    }
  }

  async #forward(request: RelayProxyRequest): Promise<RelayProxyResponse> {
    const actorToken = this.#options.actorTokens[request.actorId];
    if (actorToken === undefined) {
      return {
        kind: "response",
        id: request.id,
        status: 403,
        body: errorBody("actor_mismatch", request.id),
      };
    }
    try {
      const response = await fetch(
        new URL(request.path, this.#options.brokerUrl),
        {
          method: request.method,
          headers: {
            authorization: `Bearer ${actorToken}`,
            ...(request.body === undefined
              ? {}
              : { "content-type": "application/json" }),
          },
          ...(request.body === undefined ? {} : { body: request.body }),
        },
      );
      const body = await readBoundedResponse(response, this.#maxBodyBytes);
      return {
        kind: "response",
        id: request.id,
        status: response.status,
        body,
      };
    } catch {
      return {
        kind: "response",
        id: request.id,
        status: 502,
        body: errorBody("broker_unavailable", request.id),
      };
    }
  }
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > maxBytes
  ) {
    throw new Error("Local broker response exceeds bridge limit");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error("Local broker response exceeds bridge limit");
  }
  return buffer.toString("utf8");
}

function assertLoopbackUrl(url: URL, protocols: string[]): void {
  const hostname = url.hostname.toLowerCase();
  if (
    !protocols.includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]", "::1"].includes(hostname)
  ) {
    throw new Error("Trusted bridge endpoints must use loopback");
  }
}

function errorBody(code: string, requestId: string): string {
  return JSON.stringify({
    error: {
      code,
      message: "Trusted bridge request failed",
      requestId,
    },
  });
}
