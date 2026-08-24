export const ACTOR_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,62})$/;

export interface CreateModelSessionRequest {
  model?: string;
  tools?: ModelToolDefinition[];
}

export interface CreateModelSessionResponse {
  sessionId: string;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, JsonValue>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, JsonValue>;
}

export interface ModelToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
}

export type ModelTurnRequest =
  | {
      kind: "prompt";
      content: string;
    }
  | {
      kind: "tool_results";
      results: ModelToolResult[];
    };

export type ModelTurnResponse =
  | {
      kind: "assistant";
      content: string;
    }
  | {
      kind: "tool_calls";
      calls: ModelToolCall[];
    };

export type ModelMessageRequest = ModelTurnRequest;

export type ModelMessageResponse = ModelTurnResponse & {
  requestId: string;
}

export interface BrokerHealthResponse {
  status: "ok";
  backend: string;
}

export interface BrokerErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
