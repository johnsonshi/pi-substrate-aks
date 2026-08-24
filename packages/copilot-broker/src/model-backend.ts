export interface CreateBackendSessionInput {
  actorId: string;
  model?: string;
}

export interface SendBackendMessageInput {
  sessionId: string;
  content: string;
  signal: AbortSignal;
}

export interface ModelBackend {
  readonly name: string;
  createSession(input: CreateBackendSessionInput): Promise<string>;
  sendMessage(input: SendBackendMessageInput): Promise<string>;
  deleteSession(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

