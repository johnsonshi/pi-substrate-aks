import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ActorTokenAuthorizer } from "../packages/copilot-broker/src/actor-token-authorizer.js";
import { CopilotSdkBackend } from "../packages/copilot-broker/src/copilot-sdk-backend.js";
import { BrokerServer } from "../packages/copilot-broker/src/http-server.js";
import { PiActor } from "../packages/pi-actor/src/pi-actor.js";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../tests/fixtures/simple-calculator",
);
const workspace = await mkdtemp(join(tmpdir(), "pisa-pi-copilot-"));
const actorId = "local-pi-copilot-smoke";
const actorToken = randomBytes(32).toString("base64url");
const server = new BrokerServer({
  backend: new CopilotSdkBackend(),
  authorizer: new ActorTokenAuthorizer({ [actorId]: actorToken }),
  requestTimeoutMs: 300_000,
});

try {
  await cp(fixture, workspace, { recursive: true });
  const actor = new PiActor({
    actorId,
    actorToken,
    brokerUrl: await server.listen(),
    workspace,
    ...(process.env.PISA_COPILOT_MODEL === undefined
      ? {}
      : { model: process.env.PISA_COPILOT_MODEL }),
  });
  const result = await actor.run(
    "Open math.js. Fix the exported add function by replacing subtraction with addition. Run `npm test` and stop only after the tests pass.",
    AbortSignal.timeout(300_000),
  );

  assert.match(await readFile(join(workspace, "math.js"), "utf8"), /left \+ right/);
  assert.deepEqual(result.changedFiles, [
    { path: "math.js", status: "modified" },
  ]);
  assert.equal(
    result.events.some(
      (event) =>
        event.type === "tool_end" &&
        event.toolName === "workspace_test" &&
        event.isError === false,
    ),
    true,
  );
  assert.notEqual(result.finalText.trim(), "");
  console.log("PISA_PI_COPILOT_OK");
} finally {
  await server.close();
  await rm(workspace, { recursive: true, force: true });
}
