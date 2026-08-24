import { RemoteActorServer } from "./remote-actor-server.js";

const port = parsePort(process.env.PISA_ACTOR_PORT ?? "8080");
const server = new RemoteActorServer({
  actorId: requiredEnvironment("PISA_ACTOR_ID"),
  actorToken: requiredEnvironment("PISA_ACTOR_TOKEN"),
  jobTokenSha256: requiredEnvironment("PISA_JOB_TOKEN_SHA256"),
  brokerUrl: new URL(requiredEnvironment("PISA_BROKER_URL")),
  workRoot: requiredEnvironment("PISA_WORK_ROOT"),
  onUnresponsiveRun: () => process.exit(124),
  onJobFinished: () => setImmediate(() => process.exit(0)),
  ...(process.env.PISA_MODEL === undefined
    ? {}
    : { model: process.env.PISA_MODEL }),
});
await server.listen("0.0.0.0", port);

const stop = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.once("SIGINT", () => {
  void stop();
});
process.once("SIGTERM", () => {
  void stop();
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length < 1) {
    throw new Error(`Required environment variable ${name} is missing`);
  }
  return value;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Actor port is invalid");
  }
  return port;
}
