import type {
  ModelToolDefinition,
  ModelTurnRequest,
  ModelTurnResponse,
} from "@pisa/protocol";

export interface CreateBackendSessionInput {
  actorId: string;
  model?: string;
  tools?: ModelToolDefinition[];
}

export interface SendBackendMessageInput {
  sessionId: string;
  turn: ModelTurnRequest;
  signal: AbortSignal;
}

export interface ModelBackend {
  readonly name: string;
  createSession(input: CreateBackendSessionInput): Promise<string>;
  sendMessage(input: SendBackendMessageInput): Promise<ModelTurnResponse>;
  deleteSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}
