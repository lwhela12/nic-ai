import { app, BrowserWindow, shell, dialog } from "electron";
import { join } from "path";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { homedir } from "os";
import { ServerManager } from "./server-manager.js";
import {
  checkClaudeCLI,
  installClaudeCLI,
  getWorkingCLICommand,
  checkNpmAvailable,
  getCachedCLICommand,
} from "./cli-setup.js";

// File-based logging for debugging GUI launch issues
const LOG_DIR = join(homedir(), "AppData", "Local", "Claude PI");
const LOG_FILE = join(LOG_DIR, "debug.log");
const MAIN_START_MS = Date.now();

function debugLog(msg: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [main] ${msg}\n`;
  console.log(`[Main] ${msg}`);
  try {
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    appendFileSync(LOG_FILE, line);
  } catch (e) {
    // Ignore logging errors
  }
}

function elapsedMs(from: number): number {
  return Date.now() - from;
}

const isDev = !app.isPackaged;
const resourcesPath = isDev ? join(__dirname, "..") : process.resourcesPath;

// Log startup immediately
debugLog("=== ELECTRON MAIN STARTING ===");
debugLog(`isDev: ${isDev}`);
debugLog(`resourcesPath: ${resourcesPath}`);
debugLog(`__dirname: ${__dirname}`);
debugLog(`process.execPath: ${process.execPath}`);
debugLog(`app.isPackaged: ${app.isPackaged}`);

let serverManager: ServerManager | null = null;
let mainWindow: BrowserWindow | null = null;
let serverPort: number = 0;
let cliCommand: string | null = null;

function createWindow(): void {
  const windowStartMs = Date.now();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: "Claude PI",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.webContents.once("did-finish-load", () => {
    debugLog(
      `[perf] did-finish-load at +${elapsedMs(windowStartMs)}ms (total +${elapsedMs(MAIN_START_MS)}ms)`
    );
  });

  mainWindow.once("ready-to-show", () => {
    debugLog(
      `[perf] ready-to-show at +${elapsedMs(windowStartMs)}ms (total +${elapsedMs(MAIN_START_MS)}ms)`
    );
    mainWindow?.show();
  });
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`http://127.0.0.1:${serverPort}`)) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${serverPort}`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

/**
 * Check and ensure Claude Code CLI is available.
 * Shows setup dialog if installation is needed.
 */
async function ensureCLIAvailable(): Promise<string | null> {
  debugLog("ensureCLIAvailable() called");
  const ensureStartMs = Date.now();

  // Fast startup path: trust last known-good command.
  const cachedCommand = getCachedCLICommand();
  if (cachedCommand) {
    debugLog(`Using cached CLI command: ${cachedCommand}`);
    debugLog(`[perf] ensureCLIAvailable completed in ${elapsedMs(ensureStartMs)}ms (cache hit)`);
    return cachedCommand;
  }

  const status = await checkClaudeCLI({
    allowNpxFallback: false,
    useCache: false,
    directTimeoutMs: 2500,
  });
  debugLog(`CLI status: ${JSON.stringify(status)}`);

  if (status.available) {
    debugLog(`CLI available via ${status.method}: ${status.version}`);
    debugLog(`[perf] ensureCLIAvailable completed in ${elapsedMs(ensureStartMs)}ms`);
    return status.path || "claude";
  }

  debugLog("CLI not available, checking npm...");

  // Check if npm is available before offering to install
  const npmAvailable = await checkNpmAvailable();

  if (!npmAvailable) {
    // npm not available - show error with instructions
    await dialog.showMessageBox({
      type: "error",
      title: "Node.js Required",
      message: "Node.js is not installed",
      detail:
        "Claude PI requires Node.js to be installed.\n\n" +
        "Please install Node.js from https://nodejs.org and restart the app.\n\n" +
        "After installing, you may need to restart your computer for PATH changes to take effect.",
      buttons: ["OK"],
    });
    debugLog(`[perf] ensureCLIAvailable completed in ${elapsedMs(ensureStartMs)}ms (npm missing)`);
    return null;
  }

  // Show dialog offering to install
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Install Now", "Cancel"],
    defaultId: 0,
    title: "Setup Required",
    message: "Claude Code CLI is required",
    detail:
      "Claude PI needs the Claude Code CLI to process documents.\n\n" +
      "Would you like to install it now? This will run:\n" +
      "npm install -g @anthropic-ai/claude-code\n\n" +
      "This may take a few minutes.",
  });

  if (result.response === 1) {
    // User cancelled
    console.log("[Main] User cancelled CLI installation");
    debugLog(`[perf] ensureCLIAvailable completed in ${elapsedMs(ensureStartMs)}ms (cancelled)`);
    return null;
  }

  // Show progress window
  const progressWin = new BrowserWindow({
    width: 450,
    height: 180,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  progressWin.loadURL(
    `data:text/html,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          padding: 24px;
          background: #f5f5f5;
          margin: 0;
          display: flex;
          flex-direction: column;
          height: 100vh;
          box-sizing: border-box;
        }
        h3 {
          margin: 0 0 16px 0;
          font-size: 18px;
          color: #333;
        }
        #status {
          color: #666;
          font-size: 14px;
          margin: 0;
        }
        .spinner {
          margin-top: auto;
          display: flex;
          align-items: center;
          gap: 8px;
          color: #888;
          font-size: 12px;
        }
        .spinner::before {
          content: "";
          width: 16px;
          height: 16px;
          border: 2px solid #ddd;
          border-top-color: #666;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    </head>
    <body>
      <h3>Installing Claude Code CLI...</h3>
      <p id="status">Please wait...</p>
      <div class="spinner">This may take a few minutes</div>
    </body>
    </html>
  `)}`
  );

  // Run installation
  const installResult = await installClaudeCLI((msg) => {
    progressWin.webContents.executeJavaScript(
      `document.getElementById('status').textContent = ${JSON.stringify(msg)}`
    );
  });

  progressWin.close();

  if (installResult.success) {
    // Get the working command
    const command = await getWorkingCLICommand({
      allowNpxFallback: true,
      useCache: true,
      directTimeoutMs: 3000,
      npxTimeoutMs: 60000,
    });
    if (command) {
      await dialog.showMessageBox({
        type: "info",
        title: "Installation Complete",
        message: "Claude Code CLI installed successfully!",
        detail: "The app is now ready to use.",
        buttons: ["OK"],
      });
      debugLog(
        `[perf] ensureCLIAvailable completed in ${elapsedMs(ensureStartMs)}ms (installed)`
      );
      return command;
    }
  }

  // Installation failed - show error with manual instructions
  await dialog.showMessageBox({
    type: "error",
    title: "Installation Failed",
    message: "Could not install Claude Code CLI automatically.",
    detail:
      `Error: ${installResult.error}\n\n` +
      "Please try installing manually:\n\n" +
      "1. Open Command Prompt (Windows) or Terminal (Mac/Linux)\n" +
      "2. Run: npm install -g @anthropic-ai/claude-code\n" +
      "3. Restart Claude PI\n\n" +
      "On Mac/Linux, you may need to use: sudo npm install -g @anthropic-ai/claude-code",
    buttons: ["OK"],
  });

  debugLog(`[perf] ensureCLIAvailable completed in ${elapsedMs(ensureStartMs)}ms (failed)`);
  return null;
}

async function startApp(): Promise<void> {
  const startupStartMs = Date.now();
  debugLog(`startApp() called - isDev: ${isDev}`);
  debugLog(`[perf] startup begin (total +${elapsedMs(MAIN_START_MS)}ms since main import)`);

  // First, ensure CLI is available
  const cliStartMs = Date.now();
  cliCommand = await ensureCLIAvailable();
  debugLog(`[perf] CLI step took ${elapsedMs(cliStartMs)}ms`);

  if (!cliCommand) {
    debugLog("CLI not available, quitting");
    debugLog(`[perf] startup aborted after ${elapsedMs(startupStartMs)}ms`);
    app.quit();
    return;
  }

  debugLog(`Using CLI command: ${cliCommand}`);

  // Start server with CLI command
  serverManager = new ServerManager({ isDev, resourcesPath, cliCommand });

  try {
    debugLog("Starting server...");
    const serverStartMs = Date.now();
    serverPort = await serverManager.start();
    debugLog(`[perf] server start took ${elapsedMs(serverStartMs)}ms`);
    debugLog(`Server started on port ${serverPort}`);
    const createWindowStartMs = Date.now();
    createWindow();
    debugLog(`[perf] createWindow() returned in ${elapsedMs(createWindowStartMs)}ms`);
    debugLog(`[perf] startup critical path complete in ${elapsedMs(startupStartMs)}ms`);
    debugLog("Window created");
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    debugLog(`Server start FAILED: ${errMsg}`);
    dialog.showErrorBox("Startup Error", `Failed to start server:\n\n${errMsg}`);
    app.quit();
  }
}

async function cleanup(): Promise<void> {
  if (serverManager) {
    await serverManager.stop();
    serverManager = null;
  }
}

app.whenReady().then(startApp);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0 && serverManager?.isRunning()) createWindow(); });
app.on("before-quit", async (event) => { event.preventDefault(); await cleanup(); app.exit(0); });

process.on("uncaughtException", (error) => { console.error("[Main] Uncaught exception:", error); dialog.showErrorBox("Error", error.message); });
process.on("unhandledRejection", (reason) => { console.error("[Main] Unhandled rejection:", reason); });
