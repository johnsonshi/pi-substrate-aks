import { randomBytes } from "node:crypto";
import { ActorTokenAuthorizer } from "../packages/copilot-broker/src/actor-token-authorizer.js";
import { CopilotSdkBackend } from "../packages/copilot-broker/src/copilot-sdk-backend.js";
import { BrokerServer } from "../packages/copilot-broker/src/http-server.js";

const actorId = "local-copilot-smoke";
const token = randomBytes(32).toString("base64url");
const server = new BrokerServer({
  backend: new CopilotSdkBackend(),
  authorizer: new ActorTokenAuthorizer({ [actorId]: token }),
  requestTimeoutMs: 120_000,
});

const baseUrl = await server.listen();
try {
  const sessionResponse = await fetch(new URL("/v1/session", baseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: process.env.PISA_COPILOT_MODEL ?? "auto" }),
  });
  assertOk(sessionResponse, "create session");
  const session = (await sessionResponse.json()) as { sessionId: string };

  const messageResponse = await fetch(
    new URL(`/v1/session/${session.sessionId}/messages`, baseUrl),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "prompt",
        content:
          "Reply with exactly PISA_COPILOT_OK and no punctuation or explanation.",
      }),
    },
  );
  assertOk(messageResponse, "send message");
  const message = (await messageResponse.json()) as {
    kind: string;
    content: string;
  };
  if (
    message.kind !== "assistant" ||
    message.content.trim() !== "PISA_COPILOT_OK"
  ) {
    throw new Error("Copilot smoke response did not match the required marker");
  }
  console.log("PISA_COPILOT_OK");
} finally {
  await server.close();
}

function assertOk(response: Response, operation: string): void {
  if (!response.ok) {
    throw new Error(`${operation} failed with HTTP ${response.status}`);
  }
}
