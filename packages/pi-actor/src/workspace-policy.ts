import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  BashOperations,
  EditOperations,
  ReadOperations,
  WriteOperations,
} from "@earendil-works/pi-coding-agent";

const TEST_COMMANDS = new Map<string, { executable: string; args: string[] }>([
  ["npm test", { executable: "npm", args: ["test"] }],
  ["npm run test", { executable: "npm", args: ["run", "test"] }],
  ["npm run typecheck", { executable: "npm", args: ["run", "typecheck"] }],
  ["npm run build", { executable: "npm", args: ["run", "build"] }],
  ["node --test", { executable: "node", args: ["--test"] }],
]);

export class WorkspacePolicy {
  readonly #root: string;
  readonly #requestedRoot: string;

  private constructor(root: string, requestedRoot: string) {
    this.#root = root;
    this.#requestedRoot = requestedRoot;
  }

  static async create(root: string): Promise<WorkspacePolicy> {
    const requestedRoot = resolve(root);
    const canonicalRoot = await realpath(requestedRoot);
    return new WorkspacePolicy(canonicalRoot, requestedRoot);
  }

  readOperations(): ReadOperations {
    return {
      access: async (path) => access(await this.#existingPath(path), constants.R_OK),
      readFile: async (path) => readFile(await this.#existingPath(path)),
      detectImageMimeType: async () => null,
    };
  }

  editOperations(): EditOperations {
    return {
      access: async (path) =>
        access(await this.#existingPath(path), constants.R_OK | constants.W_OK),
      readFile: async (path) => readFile(await this.#existingPath(path)),
      writeFile: async (path, content) =>
        writeFile(await this.#writablePath(path), content, "utf8"),
    };
  }

  writeOperations(): WriteOperations {
    return {
      mkdir: async (path) => {
        await mkdir(await this.#writablePath(path), { recursive: true });
      },
      writeFile: async (path, content) =>
        writeFile(await this.#writablePath(path), content, "utf8"),
    };
  }

  bashOperations(): BashOperations {
    return {
      exec: async (command, cwd, options) => {
        const spec = TEST_COMMANDS.get(command.trim());
        if (spec === undefined) {
          throw new Error("Command is not in the actor test allowlist");
        }
        const canonicalCwd = await this.#existingPath(cwd);
        if (!(await stat(canonicalCwd)).isDirectory()) {
          throw new Error("Command working directory is not a directory");
        }
        const timeoutMs = Math.min(options.timeout ?? 60_000, 120_000);
        return await new Promise<{ exitCode: number | null }>((resolvePromise, reject) => {
          const detached = process.platform !== "win32";
          const child = spawn(spec.executable, spec.args, {
            cwd: canonicalCwd,
            env: {
              PATH: process.env.PATH ?? "",
              LANG: "C.UTF-8",
              CI: "1",
              HOME: "/tmp/pisa-actor-home",
              npm_config_audit: "false",
              npm_config_fund: "false",
              npm_config_update_notifier: "false",
            },
            detached,
            shell: false,
            stdio: ["ignore", "pipe", "pipe"],
          });
          child.stdout.on("data", options.onData);
          child.stderr.on("data", options.onData);
          let killTimer: NodeJS.Timeout | undefined;
          let terminating = false;
          const terminate = (): void => {
            if (terminating) {
              return;
            }
            terminating = true;
            signalProcessTree(child.pid, "SIGTERM", detached);
            killTimer = setTimeout(
              () => signalProcessTree(child.pid, "SIGKILL", detached),
              250,
            );
          };
          const timer = setTimeout(terminate, timeoutMs);
          const abort = (): void => {
            terminate();
          };
          options.signal?.addEventListener("abort", abort, { once: true });
          child.once("error", (error) => {
            clearTimeout(timer);
            if (killTimer !== undefined) {
              clearTimeout(killTimer);
            }
            options.signal?.removeEventListener("abort", abort);
            reject(error);
          });
          child.once("close", (code) => {
            clearTimeout(timer);
            if (killTimer !== undefined) {
              clearTimeout(killTimer);
            }
            signalProcessTree(child.pid, "SIGKILL", detached);
            options.signal?.removeEventListener("abort", abort);
            resolvePromise({ exitCode: code });
          });
        });
      },
    };
  }

  async #existingPath(path: string): Promise<string> {
    const lexical = this.#lexicalPath(path);
    const canonical = await realpath(lexical);
    this.#assertInside(canonical);
    this.#assertNotGitPath(canonical);
    return canonical;
  }

  async #writablePath(path: string): Promise<string> {
    const lexical = this.#lexicalPath(path);
    let existing = lexical;
    while (true) {
      try {
        const canonical = await realpath(existing);
        this.#assertInside(canonical);
        this.#assertNotGitPath(canonical);
        break;
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
        const parent = dirname(existing);
        if (parent === existing) {
          throw new Error("No writable ancestor exists inside the workspace");
        }
        existing = parent;
      }
    }
    return lexical;
  }

  #lexicalPath(path: string): string {
    const candidate = isAbsolute(path) ? resolve(path) : resolve(this.#root, path);
    const child =
      this.#relativeInside(this.#root, candidate) ??
      this.#relativeInside(this.#requestedRoot, candidate);
    if (child === undefined) {
      throw new Error("Path escapes the actor workspace");
    }
    const segments = child.split(sep);
    if (segments.includes(".git")) {
      throw new Error("Actor tools cannot access Git metadata");
    }
    return candidate;
  }

  #assertInside(path: string): void {
    if (this.#relativeInside(this.#root, path) === undefined) {
      throw new Error("Path escapes the actor workspace");
    }
  }

  #assertNotGitPath(path: string): void {
    const child = this.#relativeInside(this.#root, path);
    if (child?.split(sep).includes(".git") === true) {
      throw new Error("Actor tools cannot access Git metadata");
    }
  }

  #relativeInside(root: string, path: string): string | undefined {
    const child = relative(root, path);
    return child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)
      ? undefined
      : child;
  }
}

function signalProcessTree(
  pid: number | undefined,
  signal: NodeJS.Signals,
  detached: boolean,
): void {
  if (pid === undefined) {
    return;
  }
  try {
    if (detached) {
      process.kill(-pid, signal);
    } else {
      process.kill(pid, signal);
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      (error as NodeJS.ErrnoException).code !== "ESRCH"
    ) {
      throw error;
    }
  }
}

function isMissing(value: unknown): boolean {
  return (
    value instanceof Error &&
    "code" in value &&
    (value as NodeJS.ErrnoException).code === "ENOENT"
  );
}
