import { RelayServer } from "./relay-server.js";

const actorId = requiredEnvironment("PISA_RELAY_ACTOR_ID");
const actorToken = requiredEnvironment("PISA_RELAY_ACTOR_TOKEN");
const tunnelToken = requiredEnvironment("PISA_RELAY_TUNNEL_TOKEN");
const jobClientToken = requiredEnvironment("PISA_RELAY_JOB_CLIENT_TOKEN");
const actorJobToken = requiredEnvironment("PISA_RELAY_ACTOR_JOB_TOKEN");
const actorUrl = new URL(requiredEnvironment("PISA_RELAY_ACTOR_URL"));
const port = parsePort(process.env.PISA_RELAY_PORT ?? "8080");

const relay = new RelayServer({
  actorTokens: { [actorId]: actorToken },
  tunnelToken,
  jobProxy: {
    clientToken: jobClientToken,
    targetToken: actorJobToken,
    targetUrl: actorUrl,
  },
});
await relay.listen("0.0.0.0", port);

const stop = async (): Promise<void> => {
  await relay.close();
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
    throw new Error("Relay port is invalid");
  }
  return port;
}
