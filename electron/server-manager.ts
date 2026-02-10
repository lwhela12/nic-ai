import { spawn, ChildProcess } from "child_process";
import { createServer } from "net";
import { join } from "path";
import { existsSync, appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";

// File-based logging for debugging GUI launch issues
function getLogDir(): string {
  if (process.platform === "win32") {
    return join(homedir(), "AppData", "Local", "Claude PI");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Logs", "Claude PI");
  }
  return join(homedir(), ".local", "state", "claude-pi");
}

const LOG_DIR = getLogDir();
const LOG_FILE = join(LOG_DIR, "debug.log");

function debugLog(msg: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [server-manager] ${msg}\n`;
  console.log(`[ServerManager] ${msg}`);
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    appendFileSync(LOG_FILE, line);
  } catch (e) {
    // Ignore logging errors
  }
}

export interface ServerManagerOptions {
  isDev: boolean;
  resourcesPath: string;
  cliCommand?: string; // 'claude' or 'npx @anthropic-ai/claude-code'
}

export class ServerManager {
  private serverProcess: ChildProcess | null = null;
  private port: number = 0;
  private options: ServerManagerOptions;

  constructor(options: ServerManagerOptions) {
    this.options = options;
  }

  /**
   * Find a free port dynamically
   */
  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address && typeof address === "object") {
          const port = address.port;
          server.close(() => resolve(port));
        } else {
          reject(new Error("Could not get port"));
        }
      });
      server.on("error", reject);
    });
  }

  /**
   * Wait for the server to respond to health check
   */
  private async waitForHealth(
    port: number,
    maxAttempts = 150,
    intervalMs = 100
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          const data = await response.json();
          if (data.status === "ok") {
            return true;
          }
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  }

  /**
   * Get the path to the server executable
   */
  private getServerPath(): string {
    if (this.options.isDev) {
      // In dev mode, run the TypeScript server with Bun
      return join(this.options.resourcesPath, "..", "server", "index.ts");
    } else {
      // In production, use the compiled executable
      const exe = process.platform === "win32" ? ".exe" : "";
      return join(this.options.resourcesPath, "server", `claude-pi-server${exe}`);
    }
  }

  /**
   * Get environment variables for the server
   */
  private getServerEnv(): Record<string, string> {
    debugLog("getServerEnv() building environment...");
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      PORT: String(this.port),
      // Subscription server for auth and API key
      CLAUDE_PI_SERVER: "https://claude-pi-five.vercel.app",
    };

    // Pass the working CLI command to the server
    // This is used by the Agent SDK to spawn Claude Code processes
    if (this.options.cliCommand) {
      env.CLAUDE_CLI_COMMAND = this.options.cliCommand;
      debugLog(`CLI command set: ${this.options.cliCommand}`);
    }

    if (!this.options.isDev) {
      // In production, set paths to bundled resources
      env.RESOURCES_PATH = this.options.resourcesPath;
      env.ELECTRON_FRONTEND_PATH = join(this.options.resourcesPath, "frontend");
      env.AGENT_PROMPT_PATH = join(this.options.resourcesPath, "agent");
      // Don't set CLAUDE_CODE_CLI_PATH when global 'claude' command is available
      // The SDK will find it automatically. Only set a fallback path if no CLI is available.
      // Note: The bundled cli.js requires Node to run, so we can't use it as a direct executable.
      // Production mode for auth
      env.NODE_ENV = "production";
      debugLog(`Production env: RESOURCES_PATH=${env.RESOURCES_PATH}`);
      debugLog(`Production env: CLAUDE_CODE_CLI_PATH=${env.CLAUDE_CODE_CLI_PATH || 'NOT SET'}`);
    }

    return env;
  }

  /**
   * Start the server process
   */
  async start(): Promise<number> {
    this.port = await this.findFreePort();
    debugLog(`Starting server on port ${this.port}`);

    const serverPath = this.getServerPath();
    const env = this.getServerEnv();

    debugLog(`Server path: ${serverPath}`);
    debugLog(`isDev: ${this.options.isDev}`);
    debugLog(`Server exists: ${existsSync(serverPath)}`);

    // Check if server file exists
    if (!existsSync(serverPath)) {
      debugLog(`ERROR: Server not found at: ${serverPath}`);
      throw new Error(`Server not found at: ${serverPath}`);
    }

    if (this.options.isDev) {
      // In dev mode, run with bun
      this.serverProcess = spawn("bun", ["run", serverPath], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: join(this.options.resourcesPath, ".."),
      });
    } else {
      // In production, run the compiled executable directly
      this.serverProcess = spawn(serverPath, [], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    // Log server output
    this.serverProcess.stdout?.on("data", (data) => {
      console.log(`[Server] ${data.toString().trim()}`);
    });

    this.serverProcess.stderr?.on("data", (data) => {
      console.error(`[Server Error] ${data.toString().trim()}`);
    });

    this.serverProcess.on("error", (err) => {
      console.error(`[ServerManager] Process error:`, err);
    });

    this.serverProcess.on("exit", (code, signal) => {
      console.log(`[ServerManager] Server exited with code ${code}, signal ${signal}`);
      this.serverProcess = null;
    });

    // Wait for server to be healthy
    console.log(`[ServerManager] Waiting for health check...`);
    const healthy = await this.waitForHealth(this.port);

    if (!healthy) {
      this.stop();
      throw new Error("Server failed to start - health check timed out");
    }

    console.log(`[ServerManager] Server is healthy on port ${this.port}`);
    return this.port;
  }

  /**
   * Stop the server process gracefully
   */
  async stop(): Promise<void> {
    if (!this.serverProcess) {
      return;
    }

    console.log(`[ServerManager] Stopping server...`);

    return new Promise((resolve) => {
      const process = this.serverProcess!;
      let forceKillTimeout: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (forceKillTimeout) {
          clearTimeout(forceKillTimeout);
        }
        this.serverProcess = null;
        resolve();
      };

      process.once("exit", cleanup);

      // Try graceful shutdown first (SIGINT)
      process.kill("SIGINT");

      // Force kill after 5 seconds if still running
      forceKillTimeout = setTimeout(() => {
        if (this.serverProcess) {
          console.log(`[ServerManager] Force killing server...`);
          process.kill("SIGKILL");
        }
      }, 5000);
    });
  }

  /**
   * Get the current port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.serverProcess !== null;
  }
}
