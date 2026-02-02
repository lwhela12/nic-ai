import { app, BrowserWindow, shell, dialog } from "electron";
import { join } from "path";
import { ServerManager } from "./server-manager.js";
import {
  checkClaudeCLI,
  installClaudeCLI,
  getWorkingCLICommand,
  checkNpmAvailable,
} from "./cli-setup.js";

const isDev = !app.isPackaged;
const resourcesPath = isDev ? join(__dirname, "..") : process.resourcesPath;

let serverManager: ServerManager | null = null;
let mainWindow: BrowserWindow | null = null;
let serverPort: number = 0;
let cliCommand: string | null = null;

function createWindow(): void {
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

  mainWindow.once("ready-to-show", () => mainWindow?.show());
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
  console.log("[Main] Checking Claude Code CLI availability...");

  const status = await checkClaudeCLI();

  if (status.available) {
    console.log(`[Main] CLI available via ${status.method}: ${status.version}`);
    return status.path || "claude";
  }

  console.log("[Main] CLI not available, checking npm...");

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
    const command = await getWorkingCLICommand();
    if (command) {
      await dialog.showMessageBox({
        type: "info",
        title: "Installation Complete",
        message: "Claude Code CLI installed successfully!",
        detail: "The app is now ready to use.",
        buttons: ["OK"],
      });
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

  return null;
}

async function startApp(): Promise<void> {
  console.log(`[Main] Starting Claude PI (isDev: ${isDev})`);

  // First, ensure CLI is available
  cliCommand = await ensureCLIAvailable();

  if (!cliCommand) {
    console.log("[Main] CLI not available, quitting");
    app.quit();
    return;
  }

  console.log(`[Main] Using CLI command: ${cliCommand}`);

  // Start server with CLI command
  serverManager = new ServerManager({ isDev, resourcesPath, cliCommand });

  try {
    serverPort = await serverManager.start();
    createWindow();
  } catch (error) {
    dialog.showErrorBox("Startup Error", `Failed to start server:\n\n${error instanceof Error ? error.message : String(error)}`);
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
