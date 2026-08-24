import { RelayServer } from "./relay-server.js";

const tunnelToken = requiredEnvironment("PISA_RELAY_TUNNEL_TOKEN");
const jobClientToken = requiredEnvironment("PISA_RELAY_JOB_CLIENT_TOKEN");
const port = parsePort(process.env.PISA_RELAY_PORT ?? "8080");
const actors = readActorConfiguration();

const relay = new RelayServer({
  actorTokens: actors.tokens,
  tunnelToken,
  jobProxy: {
    clientToken: jobClientToken,
    targets: actors.targets,
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

function readActorConfiguration(): {
  tokens: Record<string, string>;
  targets: Record<
    string,
    {
      targetToken: string;
      targetUrl: URL;
    }
  >;
} {
  const countValue = process.env.PISA_RELAY_ACTOR_COUNT;
  if (countValue === undefined) {
    const actorId = requiredEnvironment("PISA_RELAY_ACTOR_ID");
    return {
      tokens: {
        [actorId]: requiredEnvironment("PISA_RELAY_ACTOR_TOKEN"),
      },
      targets: {
        [actorId]: {
          targetToken: requiredEnvironment("PISA_RELAY_ACTOR_JOB_TOKEN"),
          targetUrl: new URL(requiredEnvironment("PISA_RELAY_ACTOR_URL")),
        },
      },
    };
  }

  const count = Number(countValue);
  if (!Number.isInteger(count) || count < 1 || count > 16) {
    throw new Error("Relay actor count must be an integer from 1 to 16");
  }
  const tokens: Record<string, string> = {};
  const targets: Record<
    string,
    {
      targetToken: string;
      targetUrl: URL;
    }
  > = {};
  for (let index = 0; index < count; index += 1) {
    const prefix = `PISA_RELAY_ACTOR_${index}`;
    const actorId = requiredEnvironment(`${prefix}_ID`);
    if (Object.hasOwn(tokens, actorId)) {
      throw new Error("Relay actor IDs must be unique");
    }
    tokens[actorId] = requiredEnvironment(`${prefix}_TOKEN`);
    targets[actorId] = {
      targetToken: requiredEnvironment(`${prefix}_JOB_TOKEN`),
      targetUrl: new URL(requiredEnvironment(`${prefix}_URL`)),
    };
  }
  return { tokens, targets };
}

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
