import type { ShellEnvironment } from "./app-shell";
import { createAppShell } from "./app-shell";
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

/** Take over the current document when it is an owned route. */
export function boot(): void {
  shell.boot();
}
