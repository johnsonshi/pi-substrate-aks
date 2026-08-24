import type {
  BrokerErrorResponse,
  CreateModelSessionResponse,
  ModelToolDefinition,
  ModelTurnRequest,
  ModelTurnResponse,
} from "@pisa/protocol";

export interface BrokerClientOptions {
  baseUrl: URL;
  actorToken: string;
  model?: string;
}

export class BrokerClient {
  readonly #baseUrl: URL;
  readonly #actorToken: string;
  readonly #model: string | undefined;
  #sessionId: string | undefined;

  constructor(options: BrokerClientOptions) {
    this.#baseUrl = options.baseUrl;
    this.#actorToken = options.actorToken;
    this.#model = options.model;
  }

  async sendTurn(
    turn: ModelTurnRequest,
    tools: ModelToolDefinition[],
    signal?: AbortSignal,
  ): Promise<ModelTurnResponse> {
    const sessionId = await this.#ensureSession(tools, signal);
    const response = await this.#request(
      `/v1/session/${sessionId}/messages`,
      "POST",
      turn,
      signal,
    );
    return (await response.json()) as ModelTurnResponse;
  }

  async close(): Promise<void> {
    const sessionId = this.#sessionId;
    this.#sessionId = undefined;
    if (sessionId === undefined) {
      return;
    }
    await this.#request(`/v1/session/${sessionId}`, "DELETE");
  }

  async #ensureSession(
    tools: ModelToolDefinition[],
    signal?: AbortSignal,
  ): Promise<string> {
    if (this.#sessionId !== undefined) {
      return this.#sessionId;
    }
    const response = await this.#request(
      "/v1/session",
      "POST",
      {
        ...(this.#model === undefined ? {} : { model: this.#model }),
        tools,
      },
      signal,
    );
    const body = (await response.json()) as CreateModelSessionResponse;
    this.#sessionId = body.sessionId;
    return body.sessionId;
  }

  async #request(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    const response = await fetch(new URL(path, this.#baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.#actorToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) {
      let code = `http_${response.status}`;
      try {
        const error = (await response.json()) as BrokerErrorResponse;
        code = error.error.code;
      } catch {
        // Keep the status-only error; actor-facing errors never include response bodies.
      }
      throw new Error(`Broker request failed: ${code}`);
    }
    return response;
  }
}
