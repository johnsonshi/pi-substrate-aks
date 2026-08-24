import { ActorTokenAuthorizer } from "./actor-token-authorizer.js";
import { CopilotSdkBackend } from "./copilot-sdk-backend.js";
import { BrokerServer } from "./http-server.js";

const actorId = process.env.PISA_ACTOR_ID;
const token = process.env.PISA_BROKER_TOKEN;
if (actorId === undefined || token === undefined) {
  throw new Error("PISA_ACTOR_ID and PISA_BROKER_TOKEN are required");
}

const server = new BrokerServer({
  backend: new CopilotSdkBackend(),
  authorizer: new ActorTokenAuthorizer({ [actorId]: token }),
});
const url = await server.listen("127.0.0.1", Number(process.env.PORT ?? "0"));
console.log(`Copilot broker listening on ${url.origin}`);

let stopping = false;
const stop = async (): Promise<void> => {
  if (stopping) {
    return;
  }
  stopping = true;
  await server.close();
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

