import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "node:test";
import type { ModelTurnRequest, ModelTurnResponse } from "@pisa/protocol";
import {
  ActorTokenAuthorizer,
  BrokerServer,
  FakeModelBackend,
} from "../../packages/copilot-broker/src/index.js";
import { PiActor } from "../../packages/pi-actor/src/index.js";

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/simple-calculator",
);
const servers: BrokerServer[] = [];
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => server.close()));
  await Promise.all(
    workspaces.splice(0).map(async (workspace) =>
      rm(workspace, { recursive: true, force: true }),
    ),
  );
});

describe("Pi actor", () => {
  test("edits a fixture and runs its test through the fake broker", async () => {
    const workspace = await fixtureWorkspace();
    const actor = await startActor(workspace, scriptedCodingResponder);
    const result = await actor.run("Fix the add function and run the tests.");

    assert.match(
      await readFile(join(workspace, "math.js"), "utf8"),
      /left \+ right/,
      JSON.stringify(result),
    );
    assert.deepEqual(result.changedFiles, [
      { path: "math.js", status: "modified" },
    ]);
    assert.equal(result.finalText, "Fixed the add function and tests pass.");
    assert.deepEqual(
      result.events.filter((event) => event.type === "tool_end"),
      [
        { type: "tool_end", toolName: "workspace_read", isError: false },
        { type: "tool_end", toolName: "workspace_edit", isError: false },
        { type: "tool_end", toolName: "workspace_test", isError: false },
      ],
    );
  });

  test("blocks a model-requested path escape", async () => {
    const workspace = await fixtureWorkspace();
    const outside = join(dirname(workspace), "outside-secret.txt");
    await writeFile(outside, "must-not-be-read", "utf8");
    const actor = await startActor(workspace, escapeAttemptResponder);
    const result = await actor.run("Inspect the repository.");

    assert.equal(result.finalText, "The out-of-workspace read was blocked.");
    assert.equal(
      result.events.some(
        (event) =>
          event.type === "tool_end" &&
          event.toolName === "workspace_read" &&
          event.isError === true,
      ),
      true,
    );
    assert.match(
      result.events.find((event) => event.isError)?.error ?? "",
      /Path escapes the actor workspace/,
    );
    assert.equal(await readFile(outside, "utf8"), "must-not-be-read");
    await rm(outside);
  });

  test("blocks a canonical symlink escape", async () => {
    const workspace = await fixtureWorkspace();
    const outside = join(
      dirname(workspace),
      `${basename(workspace)}-outside-secret.txt`,
    );
    await writeFile(outside, "must-not-be-read", "utf8");
    await symlink(outside, join(workspace, "outside-link"));
    const actor = await startActor(
      workspace,
      blockedReadResponder("outside-link", "The symlink escape was blocked."),
    );
    const result = await actor.run("Inspect the linked file.");

    assert.equal(result.finalText, "The symlink escape was blocked.");
    assert.match(
      result.events.find((event) => event.isError)?.error ?? "",
      /Path escapes the actor workspace/,
    );
    assert.equal(await readFile(outside, "utf8"), "must-not-be-read");
    await rm(outside);
  });

  test("blocks Git metadata through a symlink alias", async () => {
    const workspace = await fixtureWorkspace();
    await mkdir(join(workspace, ".git"));
    await writeFile(join(workspace, ".git", "config"), "private metadata", "utf8");
    await symlink(join(workspace, ".git"), join(workspace, "git-link"));
    const actor = await startActor(
      workspace,
      blockedReadResponder(
        "git-link/config",
        "The Git metadata read was blocked.",
      ),
    );
    const result = await actor.run("Inspect the linked Git metadata.");

    assert.equal(result.finalText, "The Git metadata read was blocked.");
    assert.match(
      result.events.find((event) => event.isError)?.error ?? "",
      /Actor tools cannot access Git metadata/,
    );
  });
});

async function startActor(
  workspace: string,
  responder: (
    turn: ModelTurnRequest,
    actorId: string,
    callIndex: number,
  ) => ModelTurnResponse,
): Promise<PiActor> {
  const actorId = "actor-test";
  const actorToken = randomBytes(32).toString("base64url");
  const server = new BrokerServer({
    backend: new FakeModelBackend({ responder }),
    authorizer: new ActorTokenAuthorizer({ [actorId]: actorToken }),
  });
  servers.push(server);
  return new PiActor({
    actorId,
    actorToken,
    brokerUrl: await server.listen(),
    workspace,
  });
}

async function fixtureWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "pisa-actor-test-"));
  workspaces.push(workspace);
  await cp(fixture, workspace, { recursive: true });
  return workspace;
}

function scriptedCodingResponder(
  turn: ModelTurnRequest,
  _actorId: string,
  callIndex: number,
): ModelTurnResponse {
  assertTurnResult(callIndex, turn);
  const responses: ModelTurnResponse[] = [
    {
      kind: "tool_calls",
      calls: [
        {
          id: "read-1",
          name: "workspace_read",
          arguments: { path: "math.js" },
        },
      ],
    },
    {
      kind: "tool_calls",
      calls: [
        {
          id: "edit-1",
          name: "workspace_edit",
          arguments: {
            path: "math.js",
            edits: [
              {
                oldText: "return left - right;",
                newText: "return left + right;",
              },
            ],
          },
        },
      ],
    },
    {
      kind: "tool_calls",
      calls: [
        {
          id: "test-1",
          name: "workspace_test",
          arguments: { command: "npm test" },
        },
      ],
    },
    {
      kind: "assistant",
      content: "Fixed the add function and tests pass.",
    },
  ];
  const response = responses[callIndex];
  if (response === undefined) {
    throw new Error("Unexpected fake model call");
  }
  return response;
}

function escapeAttemptResponder(
  turn: ModelTurnRequest,
  _actorId: string,
  callIndex: number,
): ModelTurnResponse {
  if (callIndex === 0) {
    assert.equal(turn.kind, "prompt");
    return {
      kind: "tool_calls",
      calls: [
        {
          id: "escape-1",
          name: "workspace_read",
          arguments: { path: "../outside-secret.txt" },
        },
      ],
    };
  }

  assert.equal(turn.kind, "tool_results");
  assert.equal(turn.results[0]?.isError, true);
  return {
    kind: "assistant",
    content: "The out-of-workspace read was blocked.",
  };
}

function blockedReadResponder(
  path: string,
  finalText: string,
): (
  turn: ModelTurnRequest,
  actorId: string,
  callIndex: number,
) => ModelTurnResponse {
  return (turn, _actorId, callIndex) => {
    if (callIndex === 0) {
      assert.equal(turn.kind, "prompt");
      return {
        kind: "tool_calls",
        calls: [
          {
            id: "blocked-read-1",
            name: "workspace_read",
            arguments: { path },
          },
        ],
      };
    }
    assert.equal(turn.kind, "tool_results");
    assert.equal(turn.results[0]?.isError, true);
    return { kind: "assistant", content: finalText };
  };
}

function assertTurnResult(callIndex: number, turn: ModelTurnRequest): void {
  if (callIndex === 0) {
    assert.equal(turn.kind, "prompt");
    return;
  }
  assert.equal(turn.kind, "tool_results");
  assert.equal(turn.results.length, 1);
  assert.equal(turn.results[0]?.isError, false);
}
