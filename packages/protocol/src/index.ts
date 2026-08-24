export const ACTOR_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,62})$/;

export interface CreateModelSessionRequest {
  model?: string;
}

export interface CreateModelSessionResponse {
  sessionId: string;
}

export interface ModelMessageRequest {
  content: string;
}

export interface ModelMessageResponse {
  requestId: string;
  content: string;
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

