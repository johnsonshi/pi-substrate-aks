import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type TextContent,
  type ToolCall,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import type {
  JsonValue,
  ModelToolDefinition,
  ModelToolResult,
} from "@pisa/protocol";
import { BrokerClient } from "./broker-client.js";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

export function createBrokerStream(client: BrokerClient) {
  const pendingToolCallIds = new Set<string>();
  const submittedToolCallIds = new Set<string>();
  let promptSent = false;

  return (
    model: Model<string>,
    context: Context,
    options?: SimpleStreamOptions,
  ) => {
    const stream = createAssistantMessageEventStream();
    queueMicrotask(async () => {
      try {
        const tools = toToolDefinitions(context);
        const turn = promptSent
          ? {
              kind: "tool_results" as const,
              results: collectToolResults(
                context,
                pendingToolCallIds,
                submittedToolCallIds,
              ),
            }
          : {
              kind: "prompt" as const,
              content: buildInitialPrompt(context),
            };
        promptSent = true;
        const response = await client.sendTurn(turn, tools, options?.signal);
        const content: Array<TextContent | ToolCall> =
          response.kind === "assistant"
            ? [{ type: "text", text: response.content }]
            : response.calls.map((call) => {
                pendingToolCallIds.add(call.id);
                return {
                  type: "toolCall",
                  id: call.id,
                  name: call.name,
                  arguments: call.arguments,
                };
              });
        emitMessage(stream, model, content);
      } catch (error) {
        const message = createMessage(model, [], "error", toError(error).message);
        stream.push({ type: "error", reason: "error", error: message });
        stream.end(message);
      }
    });
    return stream;
  };
}

function buildInitialPrompt(context: Context): string {
  const message = [...context.messages]
    .reverse()
    .find((candidate) => candidate.role === "user");
  if (message === undefined || message.role !== "user") {
    throw new Error("Pi context has no user prompt");
  }
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((block): block is TextContent => block.type === "text")
          .map((block) => block.text)
          .join("\n");
  const systemPrompt = context.systemPrompt?.trim();
  return systemPrompt === undefined || systemPrompt.length === 0
    ? content
    : `${systemPrompt}\n\nActor task:\n${content}`;
}

function collectToolResults(
  context: Context,
  pendingToolCallIds: Set<string>,
  submittedToolCallIds: Set<string>,
): ModelToolResult[] {
  const results = context.messages
    .filter(
      (message): message is ToolResultMessage =>
        message.role === "toolResult" &&
        pendingToolCallIds.has(message.toolCallId) &&
        !submittedToolCallIds.has(message.toolCallId),
    )
    .map((message) => ({
      toolCallId: message.toolCallId,
      content: message.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      isError: message.isError,
    }));
  if (results.length === 0) {
    throw new Error("Pi context has no result for the pending tool call");
  }
  for (const result of results) {
    pendingToolCallIds.delete(result.toolCallId);
    submittedToolCallIds.add(result.toolCallId);
  }
  return results;
}

function toToolDefinitions(context: Context): ModelToolDefinition[] {
  return (context.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters as Record<string, JsonValue>,
  }));
}

function emitMessage(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
  model: Model<string>,
  content: Array<TextContent | ToolCall>,
): void {
  const stopReason = content.some((block) => block.type === "toolCall")
    ? "toolUse"
    : "stop";
  const partial = createMessage(model, []);
  stream.push({ type: "start", partial });
  const completed: Array<TextContent | ToolCall> = [];
  for (const [index, block] of content.entries()) {
    if (block.type === "text") {
      const next = { type: "text" as const, text: block.text };
      completed.push(next);
      const current = createMessage(model, [...completed], stopReason);
      stream.push({ type: "text_start", contentIndex: index, partial });
      stream.push({
        type: "text_delta",
        contentIndex: index,
        delta: block.text,
        partial: current,
      });
      stream.push({
        type: "text_end",
        contentIndex: index,
        content: block.text,
        partial: current,
      });
    } else {
      completed.push(block);
      const current = createMessage(model, [...completed], stopReason);
      stream.push({ type: "toolcall_start", contentIndex: index, partial });
      stream.push({
        type: "toolcall_delta",
        contentIndex: index,
        delta: JSON.stringify(block.arguments),
        partial: current,
      });
      stream.push({
        type: "toolcall_end",
        contentIndex: index,
        toolCall: block,
        partial: current,
      });
    }
  }
  const message = createMessage(model, content, stopReason);
  stream.push({ type: "done", reason: stopReason, message });
  stream.end(message);
}

function createMessage(
  model: Model<string>,
  content: Array<TextContent | ToolCall>,
  stopReason: AssistantMessage["stopReason"] = "stop",
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    timestamp: Date.now(),
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
