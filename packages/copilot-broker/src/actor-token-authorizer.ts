import { createHash, timingSafeEqual } from "node:crypto";

interface ActorToken {
  actorId: string;
  digest: Buffer;
}

export class ActorTokenAuthorizer {
  readonly #tokens: ActorToken[];

  constructor(tokens: Readonly<Record<string, string>>) {
    const entries = Object.entries(tokens);
    if (entries.length === 0) {
      throw new Error("At least one actor token is required");
    }

    this.#tokens = entries.map(([actorId, token]) => {
      if (token.length < 32) {
        throw new Error(`Token for actor ${actorId} must contain at least 32 characters`);
      }
      return { actorId, digest: digest(token) };
    });
  }

  authorize(header: string | undefined): string | undefined {
    if (header === undefined || !header.startsWith("Bearer ")) {
      return undefined;
    }

    const candidate = digest(header.slice("Bearer ".length));
    let actorId: string | undefined;
    for (const token of this.#tokens) {
      if (timingSafeEqual(candidate, token.digest)) {
        actorId = token.actorId;
      }
    }
    return actorId;
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

