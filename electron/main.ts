import { app, BrowserWindow, shell, dialog } from "electron";
import { join } from "path";
import { ServerManager } from "./server-manager.js";

const isDev = !app.isPackaged;
const resourcesPath = isDev ? join(__dirname, "..") : process.resourcesPath;

let serverManager: ServerManager | null = null;
let mainWindow: BrowserWindow | null = null;
let serverPort: number = 0;

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

async function startApp(): Promise<void> {
  console.log(`[Main] Starting Claude PI (isDev: ${isDev})`);
  serverManager = new ServerManager({ isDev, resourcesPath });

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
