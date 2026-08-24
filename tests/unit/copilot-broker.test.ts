import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, test } from "node:test";
import {
  ActorTokenAuthorizer,
  BrokerServer,
  FakeModelBackend,
} from "../../packages/copilot-broker/src/index.js";

const servers: BrokerServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
});

describe("Copilot broker", () => {
  test("serves credential-free health and authenticated model sessions", async () => {
    const token = tokenValue();
    const { baseUrl } = await startServer({ actorA: token });

    const health = await fetch(new URL("/healthz", baseUrl));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: "ok", backend: "fake" });

    const unauthorized = await jsonRequest(baseUrl, "/v1/session", "POST", {}, "bad");
    assert.equal(unauthorized.status, 401);

    const created = await jsonRequest(baseUrl, "/v1/session", "POST", {}, token);
    assert.equal(created.status, 201);
    const { sessionId } = (await created.json()) as { sessionId: string };

    const message = await jsonRequest(
      baseUrl,
      `/v1/session/${sessionId}/messages`,
      "POST",
      { content: "hello" },
      token,
    );
    assert.equal(message.status, 200);
    const response = (await message.json()) as {
      requestId: string;
      content: string;
    };
    assert.match(response.requestId, /^[0-9a-f-]{36}$/);
    assert.equal(response.content, "FAKE[actorA]:hello");
    assert.equal(JSON.stringify(response).includes(token), false);

    const deleted = await jsonRequest(
      baseUrl,
      `/v1/session/${sessionId}`,
      "DELETE",
      undefined,
      token,
    );
    assert.equal(deleted.status, 204);
  });

  test("prevents one actor from using another actor's session", async () => {
    const tokenA = tokenValue();
    const tokenB = tokenValue();
    const { baseUrl } = await startServer({ actorA: tokenA, actorB: tokenB });
    const created = await jsonRequest(baseUrl, "/v1/session", "POST", {}, tokenA);
    const { sessionId } = (await created.json()) as { sessionId: string };

    const response = await jsonRequest(
      baseUrl,
      `/v1/session/${sessionId}/messages`,
      "POST",
      { content: "impersonate" },
      tokenB,
    );
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "actor_mismatch");
  });

  test("rejects malformed and oversized requests without echoing input", async () => {
    const token = tokenValue();
    const { baseUrl } = await startServer(
      { actorA: token },
      { maxBodyBytes: 32 },
    );

    const malformed = await fetch(new URL("/v1/session", baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: "{secret-not-json",
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.text()).includes("secret-not-json"), false);

    const oversized = await jsonRequest(
      baseUrl,
      "/v1/session",
      "POST",
      { model: "x".repeat(64) },
      token,
    );
    assert.equal(oversized.status, 413);

    const nullBody = await jsonRequest(
      baseUrl,
      "/v1/session",
      "POST",
      null,
      token,
    );
    assert.equal(nullBody.status, 400);
  });

  test("enforces concurrency and request timeouts", async () => {
    const token = tokenValue();
    const backend = new FakeModelBackend({ delayMs: 100 });
    const { baseUrl } = await startServer(
      { actorA: token },
      {
        backend,
        maxConcurrentRequests: 1,
        requestTimeoutMs: 25,
      },
    );
    const created = await jsonRequest(baseUrl, "/v1/session", "POST", {}, token);
    const { sessionId } = (await created.json()) as { sessionId: string };

    const first = jsonRequest(
      baseUrl,
      `/v1/session/${sessionId}/messages`,
      "POST",
      { content: "slow" },
      token,
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await jsonRequest(
      baseUrl,
      `/v1/session/${sessionId}/messages`,
      "POST",
      { content: "also slow" },
      token,
    );
    assert.equal(second.status, 429);
    assert.equal((await first).status, 504);
  });
});

interface TestServerOptions {
  backend?: FakeModelBackend;
  maxBodyBytes?: number;
  maxConcurrentRequests?: number;
  requestTimeoutMs?: number;
}

async function startServer(
  tokens: Readonly<Record<string, string>>,
  options: TestServerOptions = {},
): Promise<{ baseUrl: URL }> {
  const server = new BrokerServer({
    backend: options.backend ?? new FakeModelBackend(),
    authorizer: new ActorTokenAuthorizer(tokens),
    ...(options.maxBodyBytes === undefined
      ? {}
      : { maxBodyBytes: options.maxBodyBytes }),
    ...(options.maxConcurrentRequests === undefined
      ? {}
      : { maxConcurrentRequests: options.maxConcurrentRequests }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
  });
  servers.push(server);
  return { baseUrl: await server.listen() };
}

function jsonRequest(
  baseUrl: URL,
  path: string,
  method: string,
  body: unknown,
  token: string,
): Promise<Response> {
  return fetch(new URL(path, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function tokenValue(): string {
  return randomBytes(32).toString("base64url");
}
