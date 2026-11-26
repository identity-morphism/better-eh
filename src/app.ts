import type { ShellEnvironment } from "./app-shell";
import { createAppShell } from "./app-shell";
import { recordError } from "./log";
import { routeView } from "./routes";

/** Production adapter: supply the shell the browser's own globals and route table. */
const environment: ShellEnvironment = {
  url: () => location.href,
  location,
  history,
  document,
  navigator,
  window,
  setTimeout: (handler, timeoutMs) => window.setTimeout(handler, timeoutMs),
  views: { routeView },
};

const shell = createAppShell(environment);

let listenersInstalled = false;

/** Take over the current document when it is an owned route. */
export function boot(): void {
  if (!listenersInstalled) {
    listenersInstalled = true;
    window.addEventListener("error", (event) => {
      recordError(event.error ?? event.message, "window.error");
    });
    window.addEventListener("unhandledrejection", (event) => {
      recordError(event.reason, "unhandledrejection");
    });
  }
  shell.boot();
}
