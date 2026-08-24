import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterEach, test } from "node:test";
import {
  ActorTokenAuthorizer,
  BrokerServer,
  FakeModelBackend,
} from "@pisa/copilot-broker";
import { RelayServer, TrustedBridge } from "@pisa/model-relay";
import { BrokerClient } from "@pisa/pi-actor";

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.allSettled(closers.splice(0).reverse().map((close) => close()));
});

test("relay forwards an authenticated actor through the trusted bridge", async () => {
  const brokerActorToken = token();
  const relayActorToken = token();
  const tunnelToken = token();
  const broker = new BrokerServer({
    backend: new FakeModelBackend(),
    authorizer: new ActorTokenAuthorizer({
      "actor-one": brokerActorToken,
    }),
  });
  const brokerUrl = await broker.listen();
  closers.push(async () => broker.close());

  const relay = new RelayServer({
    actorTokens: { "actor-one": relayActorToken },
    tunnelToken,
  });
  const relayUrl = await relay.listen();
  closers.push(async () => relay.close());

  const tunnelUrl = new URL("/v1/tunnel", relayUrl);
  tunnelUrl.protocol = "ws:";
  const bridge = new TrustedBridge({
    relayUrl: tunnelUrl,
    tunnelToken,
    brokerUrl,
    actorTokens: { "actor-one": brokerActorToken },
  });
  await bridge.connect();
  closers.push(async () => bridge.close());

  const client = new BrokerClient({
    baseUrl: relayUrl,
    actorToken: relayActorToken,
  });
  closers.push(async () => client.close());
  const response = await client.sendTurn(
    { kind: "prompt", content: "hello" },
    [],
  );
  assert.equal(response.kind, "assistant");
  assert.equal(response.content, "FAKE[actor-one]:hello");
  assert.equal(relay.bridgeConnected, true);
});

test("relay carries a maximally escaped body without dropping the bridge", async () => {
  const brokerActorToken = token();
  const relayActorToken = token();
  const tunnelToken = token();
  const broker = new BrokerServer({
    backend: new FakeModelBackend(),
    authorizer: new ActorTokenAuthorizer({
      "actor-one": brokerActorToken,
    }),
  });
  const brokerUrl = await broker.listen();
  closers.push(async () => broker.close());

  const relay = new RelayServer({
    actorTokens: { "actor-one": relayActorToken },
    tunnelToken,
  });
  const relayUrl = await relay.listen();
  closers.push(async () => relay.close());

  const tunnelUrl = new URL("/v1/tunnel", relayUrl);
  tunnelUrl.protocol = "ws:";
  const bridge = new TrustedBridge({
    relayUrl: tunnelUrl,
    tunnelToken,
    brokerUrl,
    actorTokens: { "actor-one": brokerActorToken },
  });
  await bridge.connect();
  closers.push(async () => bridge.close());

  const client = new BrokerClient({
    baseUrl: relayUrl,
    actorToken: relayActorToken,
  });
  closers.push(async () => client.close());
  const content = "\\".repeat(28_000);
  const response = await client.sendTurn(
    { kind: "prompt", content },
    [],
  );
  assert.equal(response.kind, "assistant");
  assert.equal(response.content, `FAKE[actor-one]:${content}`);
  assert.equal(relay.bridgeConnected, true);
});

test("relay fails closed without a connected trusted bridge", async () => {
  const actorToken = token();
  const relay = new RelayServer({
    actorTokens: { "actor-one": actorToken },
    tunnelToken: token(),
  });
  const relayUrl = await relay.listen();
  closers.push(async () => relay.close());

  const response = await fetch(new URL("/v1/session", relayUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${actorToken}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(response.status, 503);
  const body = (await response.json()) as {
    error: { code: string };
  };
  assert.equal(body.error.code, "relay_unavailable");
});

test("relay rejects actor authentication before proxying", async () => {
  const relay = new RelayServer({
    actorTokens: { "actor-one": token() },
    tunnelToken: token(),
  });
  const relayUrl = await relay.listen();
  closers.push(async () => relay.close());

  const response = await fetch(new URL("/v1/session", relayUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(response.status, 401);
});

test("relay proxies capability-authenticated jobs only to a private target", async () => {
  const jobClientToken = token();
  const actorJobToken = token();
  const target = createServer(
    (request: IncomingMessage, response: ServerResponse) => {
      assert.equal(request.headers.authorization, `Bearer ${actorJobToken}`);
      response.setHeader("content-type", "application/json");
      response.end('{"status":"accepted"}');
    },
  );
  const targetUrl = await listen(target);
  closers.push(
    async () =>
      new Promise<void>((resolve, reject) => {
        target.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      }),
  );
  const relay = new RelayServer({
    actorTokens: { "actor-one": token() },
    tunnelToken: token(),
    jobProxy: {
      clientToken: jobClientToken,
      targetToken: actorJobToken,
      targetUrl: new URL("/v1/run", targetUrl),
    },
  });
  const relayUrl = await relay.listen();
  closers.push(async () => relay.close());

  const unauthorized = await fetch(
    new URL("/v1/actor/run", relayUrl),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token()}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  assert.equal(unauthorized.status, 401);

  const downstreamCredential = await fetch(
    new URL("/v1/actor/run", relayUrl),
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${actorJobToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  assert.equal(downstreamCredential.status, 401);

  const authorized = await fetch(new URL("/v1/actor/run", relayUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobClientToken}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(authorized.status, 200);
  assert.deepEqual(await authorized.json(), { status: "accepted" });
});

test("relay rejects a malformed upgrade target without crashing", async () => {
  const relay = new RelayServer({
    actorTokens: { "actor-one": token() },
    tunnelToken: token(),
  });
  const relayUrl = await relay.listen();
  closers.push(async () => relay.close());

  const response = await rawRequest(
    Number(relayUrl.port),
    [
      "GET http://[ HTTP/1.1",
      "Host: 127.0.0.1",
      "Connection: Upgrade",
      "Upgrade: websocket",
      "",
      "",
    ].join("\r\n"),
  );
  assert.match(response, /^HTTP\/1\.1 400 Bad Request/m);

  const health = await fetch(new URL("/healthz", relayUrl));
  assert.equal(health.status, 200);
});

async function listen(server: ReturnType<typeof createServer>): Promise<URL> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}`);
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

async function rawRequest(port: number, request: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    let settled = false;
    const finish = (): void => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };
    socket.setTimeout(2_000, () => {
      socket.destroy();
      finish();
    });
    socket.on("connect", () => socket.end(request));
    socket.on("data", (chunk: Buffer) => {
      response += chunk.toString("utf8");
    });
    socket.on("end", finish);
    socket.on("close", finish);
    socket.on("error", reject);
  });
}
