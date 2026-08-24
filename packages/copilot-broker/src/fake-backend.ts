import { randomUUID } from "node:crypto";
import type { ModelTurnRequest, ModelTurnResponse } from "@pisa/protocol";
import type {
  CreateBackendSessionInput,
  ModelBackend,
  SendBackendMessageInput,
} from "./model-backend.js";

export interface FakeModelBackendOptions {
  delayMs?: number;
  responder?: (
    turn: ModelTurnRequest,
    actorId: string,
    callIndex: number,
  ) => ModelTurnResponse;
}

export class FakeModelBackend implements ModelBackend {
  readonly name = "fake";
  readonly #sessions = new Map<string, { actorId: string; callIndex: number }>();
  readonly #delayMs: number;
  readonly #responder: (
    turn: ModelTurnRequest,
    actorId: string,
    callIndex: number,
  ) => ModelTurnResponse;

  constructor(options: FakeModelBackendOptions = {}) {
    this.#delayMs = options.delayMs ?? 0;
    this.#responder =
      options.responder ??
      ((turn, actorId) => ({
        kind: "assistant",
        content:
          turn.kind === "prompt"
            ? `FAKE[${actorId}]:${turn.content}`
            : `FAKE[${actorId}]:tool-results`,
      }));
  }

  async createSession(input: CreateBackendSessionInput): Promise<string> {
    const sessionId = randomUUID();
    this.#sessions.set(sessionId, { actorId: input.actorId, callIndex: 0 });
    return sessionId;
  }

  async sendMessage(input: SendBackendMessageInput): Promise<ModelTurnResponse> {
    const state = this.#sessions.get(input.sessionId);
    if (state === undefined) {
      throw new Error("Unknown fake backend session");
    }

    if (this.#delayMs > 0) {
      await abortableDelay(this.#delayMs, input.signal);
    }
    input.signal.throwIfAborted();
    const response = this.#responder(input.turn, state.actorId, state.callIndex);
    state.callIndex += 1;
    return response;
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.#sessions.delete(sessionId);
  }

  async close(): Promise<void> {
    this.#sessions.clear();
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
