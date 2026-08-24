import { ACTOR_ID_PATTERN } from "@pisa/protocol";

export interface RelayProxyRequest {
  kind: "request";
  id: string;
  actorId: string;
  method: "POST" | "DELETE";
  path: string;
  body?: string;
}

export interface RelayProxyResponse {
  kind: "response";
  id: string;
  status: number;
  body: string;
}

const REQUEST_ID_PATTERN = /^[0-9a-f-]{36}$/;
const SESSION_PATH_PATTERN =
  /^\/v1\/session\/[0-9a-f-]+(?:\/messages)?$/;

export function encodedRelayFrameLimit(maxBodyBytes: number): number {
  return maxBodyBytes * 6 + 16 * 1024;
}

export function isRelayProxyRequest(
  value: unknown,
  maxBodyBytes: number,
): value is RelayProxyRequest {
  if (
    !isRecord(value) ||
    value.kind !== "request" ||
    typeof value.id !== "string" ||
    !REQUEST_ID_PATTERN.test(value.id) ||
    typeof value.actorId !== "string" ||
    !ACTOR_ID_PATTERN.test(value.actorId) ||
    (value.method !== "POST" && value.method !== "DELETE") ||
    typeof value.path !== "string" ||
    !isAllowedProxyRoute(value.method, value.path)
  ) {
    return false;
  }
  return (
    value.body === undefined ||
    (typeof value.body === "string" &&
      Buffer.byteLength(value.body, "utf8") <= maxBodyBytes)
  );
}

export function isRelayProxyResponse(
  value: unknown,
  maxBodyBytes: number,
): value is RelayProxyResponse {
  return (
    isRecord(value) &&
    value.kind === "response" &&
    typeof value.id === "string" &&
    REQUEST_ID_PATTERN.test(value.id) &&
    typeof value.status === "number" &&
    Number.isInteger(value.status) &&
    value.status >= 100 &&
    value.status <= 599 &&
    typeof value.body === "string" &&
    Buffer.byteLength(value.body, "utf8") <= maxBodyBytes
  );
}

export function isAllowedProxyRoute(method: string, path: string): boolean {
  if (method === "POST" && path === "/v1/session") {
    return true;
  }
  if (!SESSION_PATH_PATTERN.test(path)) {
    return false;
  }
  if (method === "DELETE") {
    return !path.endsWith("/messages");
  }
  return method === "POST" && path.endsWith("/messages");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
