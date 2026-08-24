import type {
  ActorEvent,
  ChangedFile,
} from "@pisa/pi-actor";
import type {
  SourceArchiveEntry,
} from "@pisa/orchestrator";

export interface RemoteSourceArchive {
  revision: string;
  sha256: string;
  bytes: number;
  entries: SourceArchiveEntry[];
  contentBase64: string;
}

export interface RemoteActorRunRequest {
  task: string;
  source: RemoteSourceArchive;
}

export interface RemotePatchArtifact {
  sourceRevision: string;
  sha256: string;
  bytes: number;
  changedPaths: string[];
  contentBase64: string;
}

export interface RemoteActorRunResponse {
  requestId: string;
  actorId: string;
  events: ActorEvent[];
  changedFiles: ChangedFile[];
  patch: RemotePatchArtifact;
}

export interface RemoteActorErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
