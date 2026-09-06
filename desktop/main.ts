import { app, BrowserWindow, dialog, Menu, screen, session, shell } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { Schema } from "effect";
import { startBackend, type DesktopBackend } from "./backend.ts";

const Configuration = Schema.Struct({
  toolPaths: Schema.optional(Schema.Array(Schema.String)),
  port: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1024, 65535))),
  pluginConfig: Schema.optional(Schema.String),
  workspaceLocations: Schema.optional(Schema.Array(Schema.String)),
});
const Bounds = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
const mock = process.argv.includes("--mock");
app.setName("Observatory");
const profile = join(app.getPath("appData"), mock ? "Observatory-mock" : "Observatory");
app.setPath("userData", profile);
mkdirSync(profile, { recursive: true });
const configPath = join(profile, "desktop.json");
const boundsPath = join(profile, "window.json");
let window: BrowserWindow | undefined;
let backend: DesktopBackend | undefined;
let quitting = false;
let stopped = false;
let booting = false;
let origin: string | undefined;

const readConfiguration = () => {
  try {
    return Schema.decodeUnknownSync(Configuration)(JSON.parse(readFileSync(configPath, "utf8")));
  } catch (error) {
    // SAFETY: filesystem errors expose code; other parse/validation errors do not match ENOENT.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Invalid configuration. Check ${configPath}`, { cause: error });
  }
};

const createWindow = (): BrowserWindow => {
  const workArea = screen.getPrimaryDisplay().workArea;
  let bounds = {
    x: workArea.x,
    y: workArea.y,
    width: Math.min(1440, workArea.width),
    height: Math.min(960, workArea.height),
  };
  try {
    const saved = Schema.decodeUnknownSync(Bounds)(JSON.parse(readFileSync(boundsPath, "utf8")));
    const display = screen.getDisplayMatching(saved).workArea;
    bounds = {
      ...saved,
      x: Math.max(
        display.x,
        Math.min(saved.x, display.x + display.width - Math.min(saved.width, display.width)),
      ),
      y: Math.max(
        display.y,
        Math.min(saved.y, display.y + display.height - Math.min(saved.height, display.height)),
      ),
      width: Math.min(display.width, Math.max(800, saved.width)),
      height: Math.min(display.height, Math.max(600, saved.height)),
    };
  } catch {
    /* First launch uses default bounds. */
  }
  const current = new BrowserWindow({
    ...bounds,
    title: "Observatory",
    backgroundColor: "#151716",
    webPreferences: {
      partition: mock ? "persist:observatory-mock" : "persist:observatory",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  current.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//u.test(url)) {
      void dialog
        .showMessageBox(current, {
          message: "Open this link in your browser?",
          detail: url,
          buttons: ["Open", "Cancel"],
          defaultId: 1,
          cancelId: 1,
        })
        .then(({ response }) => {
          if (response === 0) void shell.openExternal(url);
        });
    }
    return { action: "deny" };
  });
  current.webContents.on("will-navigate", (event, url) => {
    if (!origin || new URL(url).origin !== origin) event.preventDefault();
  });
  current.webContents.on("will-attach-webview", (event) => event.preventDefault());
  current.webContents.on("render-process-gone", () => {
    if (!quitting)
      void recover(
        "The application view stopped. Reload to reconnect without restarting your Agents.",
      );
  });
  current.on("close", () => {
    writeFileSync(boundsPath, JSON.stringify(current.getNormalBounds()), { mode: 0o600 });
  });
  current.on("closed", () => {
    if (window === current) window = undefined;
  });
  window = current;
  return current;
};

const showStatus = async (message: string): Promise<void> => {
  const current = window ?? createWindow();
  const html = `<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="background:#151716;color:#eeeee5;font:18px system-ui;padding:64px"><h1>Observatory</h1><p>${message}</p></body></html>`;
  await current.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
};

const recover = async (message: string): Promise<void> => {
  await showStatus("Disconnected. Your Agents remain owned by the session host.");
  const result = await dialog.showMessageBox({
    type: "error",
    title: "Observatory",
    message,
    detail: `Desktop configuration: ${configPath}\nHerdr must be installed and running independently. Observatory never starts or stops its server.`,
    buttons: ["Retry", "Quit"],
    cancelId: 1,
  });
  if (result.response === 0) {
    if (backend && origin) await (window ?? createWindow()).loadURL(origin);
    else await boot();
  } else app.quit();
};

const boot = async (): Promise<void> => {
  if (booting || quitting) return;
  booting = true;
  try {
    await showStatus("Starting the local control plane…");
    const configuration = readConfiguration();
    const root = app.isPackaged ? join(process.resourcesPath, "app") : resolve(__dirname, "..");
    const executable = app.isPackaged
      ? join(root, "runtime", "bun")
      : process.env.AO_BUN_EXECUTABLE;
    if (!executable) throw new Error("Start development with bun run desktop:dev or desktop:mock.");
    const developing = !app.isPackaged && process.env.AO_DESKTOP_DEV === "1";
    const port = developing ? 4331 : (configuration.port ?? (mock ? 4320 : 4310));
    origin = `http://127.0.0.1:${developing ? 4330 : port}`;
    const currentBackend = startBackend({
      executable,
      root,
      origin,
      environment: {
        ...process.env,
        AO_HOST: mock ? "mock" : "herdr",
        AO_DB_PATH: join(profile, "ao.sqlite"),
        AO_WEB_PORT: String(port),
        AO_WEB_ALLOWED_ORIGIN: origin,
        AO_MOCK_SCENARIO: mock ? "portfolio" : undefined,
        AO_MOCK_SEED: mock ? "portfolio" : undefined,
        AO_PLUGIN_CONFIG: configuration.pluginConfig ?? process.env.AO_PLUGIN_CONFIG,
        AO_WORKSPACE_LOCATIONS:
          configuration.workspaceLocations?.join(delimiter) ?? process.env.AO_WORKSPACE_LOCATIONS,
        PATH: [
          ...(configuration.toolPaths ?? []),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          join(app.getPath("home"), ".bun/bin"),
          process.env.PATH ?? "/usr/bin:/bin",
        ].join(delimiter),
      },
    });
    backend = currentBackend;
    const readyOrigin = await currentBackend.ready;
    const partition = session.fromPartition(
      mock ? "persist:observatory-mock" : "persist:observatory",
    );
    await partition.cookies.set({
      url: readyOrigin,
      name: "ao_desktop_session",
      value: currentBackend.token,
      httpOnly: true,
      sameSite: "strict",
      path: "/",
    });
    if (!quitting) await (window ?? createWindow()).loadURL(readyOrigin);
    void currentBackend.exited.then(async () => {
      if (backend !== currentBackend) return;
      backend = undefined;
      origin = undefined;
      if (!quitting)
        await recover(
          "The local backend stopped. Retry to restart Observatory; uncertain operations will be reconciled, not replayed.",
        );
    });
  } catch (error) {
    await backend?.stop();
    backend = undefined;
    origin = undefined;
    booting = false;
    if (!quitting) await recover(error instanceof Error ? error.message : "Startup failed.");
  } finally {
    booting = false;
  }
};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    } else if (origin) void createWindow().loadURL(origin);
  });
  app.on("activate", () => {
    if (!window && origin) void createWindow().loadURL(origin);
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (stopped) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      await backend?.stop();
      stopped = true;
      app.quit();
    })();
  });
  void app.whenReady().then(async () => {
    const partition = session.fromPartition(
      mock ? "persist:observatory-mock" : "persist:observatory",
    );
    partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    partition.setPermissionCheckHandler(() => false);
    partition.on("will-download", (event) => event.preventDefault());
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
        { role: "fileMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );
    await boot();
  });
}
