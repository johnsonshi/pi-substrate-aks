import { CopilotClient, type CopilotSession } from "@github/copilot-sdk";
import type {
  CreateBackendSessionInput,
  ModelBackend,
  SendBackendMessageInput,
} from "./model-backend.js";

const SYSTEM_MESSAGE =
  "You are a text-only model backend. You have no tools. Respond directly to the user request without attempting file, shell, network, or credential access.";

export class CopilotSdkBackend implements ModelBackend {
  readonly name = "github-copilot-sdk";
  readonly #client: CopilotClient;
  readonly #sessions = new Map<string, CopilotSession>();
  #started = false;

  constructor() {
    this.#client = new CopilotClient({
      mode: "copilot-cli",
      useLoggedInUser: true,
      logLevel: "error",
    });
  }

  async createSession(input: CreateBackendSessionInput): Promise<string> {
    await this.#ensureStarted();
    const session = await this.#client.createSession({
      model: input.model ?? "auto",
      availableTools: [],
      enableSessionStore: false,
      systemMessage: {
        mode: "replace",
        content: SYSTEM_MESSAGE,
      },
    });
    this.#sessions.set(session.sessionId, session);
    return session.sessionId;
  }

  async sendMessage(input: SendBackendMessageInput): Promise<string> {
    const session = this.#sessions.get(input.sessionId);
    if (session === undefined) {
      throw new Error("Unknown Copilot session");
    }

    const abort = (): void => {
      void session.abort();
    };
    input.signal.addEventListener("abort", abort, { once: true });
    try {
      input.signal.throwIfAborted();
      const response = await session.sendAndWait({ prompt: input.content });
      input.signal.throwIfAborted();
      if (response === undefined || response.data.content.trim().length === 0) {
        throw new Error("Copilot returned no assistant message");
      }
      return response.data.content;
    } finally {
      input.signal.removeEventListener("abort", abort);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    this.#sessions.delete(sessionId);
    await session.disconnect();
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.map(async (session) => session.disconnect()));
    if (this.#started) {
      await this.#client.stop();
      this.#started = false;
    }
  }

  async #ensureStarted(): Promise<void> {
    if (!this.#started) {
      await this.#client.start();
      this.#started = true;
    }
  }
}
