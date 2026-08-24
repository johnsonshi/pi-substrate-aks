import { randomUUID } from "node:crypto";
import type {
  CreateBackendSessionInput,
  ModelBackend,
  SendBackendMessageInput,
} from "./model-backend.js";

export interface FakeModelBackendOptions {
  delayMs?: number;
  responder?: (content: string, actorId: string) => string;
}

export class FakeModelBackend implements ModelBackend {
  readonly name = "fake";
  readonly #sessions = new Map<string, string>();
  readonly #delayMs: number;
  readonly #responder: (content: string, actorId: string) => string;

  constructor(options: FakeModelBackendOptions = {}) {
    this.#delayMs = options.delayMs ?? 0;
    this.#responder =
      options.responder ?? ((content, actorId) => `FAKE[${actorId}]:${content}`);
  }

  async createSession(input: CreateBackendSessionInput): Promise<string> {
    const sessionId = randomUUID();
    this.#sessions.set(sessionId, input.actorId);
    return sessionId;
  }

  async sendMessage(input: SendBackendMessageInput): Promise<string> {
    const actorId = this.#sessions.get(input.sessionId);
    if (actorId === undefined) {
      throw new Error("Unknown fake backend session");
    }

    if (this.#delayMs > 0) {
      await abortableDelay(this.#delayMs, input.signal);
    }
    input.signal.throwIfAborted();
    return this.#responder(input.content, actorId);
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

