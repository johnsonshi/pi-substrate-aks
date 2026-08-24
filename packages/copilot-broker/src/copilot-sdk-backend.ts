import {
  CopilotClient,
  type CopilotSession,
  type Tool,
  type ToolResultObject,
} from "@github/copilot-sdk";
import type {
  JsonValue,
  ModelToolCall,
  ModelToolResult,
  ModelTurnResponse,
} from "@pisa/protocol";
import type {
  CreateBackendSessionInput,
  ModelBackend,
  SendBackendMessageInput,
} from "./model-backend.js";

const SYSTEM_MESSAGE =
  "You are the model for a constrained coding actor. You may use only the explicitly declared actor tools. Tool execution happens in an isolated workspace outside this process. Call at most one tool at a time. Never request credentials, host files, Kubernetes access, cloud metadata, or public network access.";

interface PendingToolCall {
  resolve: (result: ToolResultObject) => void;
  reject: (error: Error) => void;
}

interface BackendSession {
  session: CopilotSession;
  events: AsyncResultQueue<ModelTurnResponse>;
  pendingTools: Map<string, PendingToolCall>;
  runActive: boolean;
}

export class CopilotSdkBackend implements ModelBackend {
  readonly name = "github-copilot-sdk";
  readonly #client: CopilotClient;
  readonly #sessions = new Map<string, BackendSession>();
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
    const events = new AsyncResultQueue<ModelTurnResponse>();
    const pendingTools = new Map<string, PendingToolCall>();
    const tools: Tool[] = (input.tools ?? []).map((definition) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
      defer: "never",
      skipPermission: true,
      handler: async (argumentsValue, invocation) =>
        new Promise<ToolResultObject>((resolve, reject) => {
          const argumentsRecord = asJsonRecord(argumentsValue);
          if (pendingTools.has(invocation.toolCallId)) {
            reject(new Error("Duplicate tool call identifier"));
            return;
          }
          pendingTools.set(invocation.toolCallId, { resolve, reject });
          const call: ModelToolCall = {
            id: invocation.toolCallId,
            name: definition.name,
            arguments: argumentsRecord,
          };
          events.push({ kind: "tool_calls", calls: [call] });
        }),
    }));
    const session = await this.#client.createSession({
      model: input.model ?? "auto",
      tools,
      availableTools: tools.map((tool) => `custom:${tool.name}`),
      toolSearch: { enabled: false },
      enableSessionStore: false,
      systemMessage: {
        mode: "replace",
        content: SYSTEM_MESSAGE,
      },
    });
    this.#sessions.set(session.sessionId, {
      session,
      events,
      pendingTools,
      runActive: false,
    });
    return session.sessionId;
  }

  async sendMessage(input: SendBackendMessageInput): Promise<ModelTurnResponse> {
    const state = this.#sessions.get(input.sessionId);
    if (state === undefined) {
      throw new Error("Unknown Copilot session");
    }

    const abort = (): void => {
      void state.session.abort();
    };
    input.signal.addEventListener("abort", abort, { once: true });
    try {
      input.signal.throwIfAborted();
      if (input.turn.kind === "prompt") {
        if (state.runActive) {
          throw new Error("Copilot session already has an active turn");
        }
        state.runActive = true;
        void state.session
          .sendAndWait({ prompt: input.turn.content }, 600_000)
          .then((response) => {
            if (
              response === undefined ||
              response.data.content.trim().length === 0
            ) {
              throw new Error("Copilot returned no assistant message");
            }
            state.events.push({
              kind: "assistant",
              content: response.data.content,
            });
          })
          .catch((error: unknown) => {
            state.events.fail(toError(error));
          })
          .finally(() => {
            state.runActive = false;
          });
      } else {
        if (!state.runActive) {
          throw new Error("Copilot session has no active tool turn");
        }
        resolveToolResults(state.pendingTools, input.turn.results);
      }
      return await state.events.shift(input.signal);
    } finally {
      input.signal.removeEventListener("abort", abort);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const state = this.#sessions.get(sessionId);
    if (state === undefined) {
      return;
    }
    this.#sessions.delete(sessionId);
    const error = new Error("Broker session closed");
    for (const pending of state.pendingTools.values()) {
      pending.reject(error);
    }
    state.pendingTools.clear();
    state.events.fail(error);
    if (state.runActive) {
      await state.session.abort();
    }
    await state.session.disconnect();
  }

  async close(): Promise<void> {
    const sessionIds = [...this.#sessions.keys()];
    await Promise.allSettled(
      sessionIds.map(async (sessionId) => this.deleteSession(sessionId)),
    );
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

function resolveToolResults(
  pendingTools: Map<string, PendingToolCall>,
  results: ModelToolResult[],
): void {
  if (results.length === 0) {
    throw new Error("Tool result list is empty");
  }
  for (const result of results) {
    const pending = pendingTools.get(result.toolCallId);
    if (pending === undefined) {
      throw new Error("Tool result does not match a pending call");
    }
  }
  for (const result of results) {
    const pending = pendingTools.get(result.toolCallId);
    if (pending === undefined) {
      continue;
    }
    pendingTools.delete(result.toolCallId);
    pending.resolve({
      textResultForLlm: result.content,
      resultType: result.isError ? "failure" : "success",
      ...(result.isError ? { error: "Actor tool execution failed" } : {}),
    });
  }
}

function asJsonRecord(value: unknown): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, JsonValue>;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

class AsyncResultQueue<T> {
  readonly #values: Array<{ value?: T; error?: Error }> = [];
  readonly #waiters: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  }> = [];

  push(value: T): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      this.#values.push({ value });
      return;
    }
    waiter.resolve(value);
  }

  fail(error: Error): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) {
      this.#values.push({ error });
      return;
    }
    waiter.reject(error);
  }

  async shift(signal: AbortSignal): Promise<T> {
    const queued = this.#values.shift();
    if (queued !== undefined) {
      if (queued.error !== undefined) {
        throw queued.error;
      }
      if (queued.value === undefined) {
        throw new Error("Backend event queue returned no value");
      }
      return queued.value;
    }
    return await new Promise<T>((resolve, reject) => {
      const waiter = { resolve, reject };
      const onAbort = (): void => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) {
          this.#waiters.splice(index, 1);
        }
        reject(toError(signal.reason));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiters.push({
        resolve: (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      });
    });
  }
}
