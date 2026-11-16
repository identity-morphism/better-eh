import { mkdirSync, watch } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  version: string;
  description: string;
}

const pkg = (await Bun.file("./package.json").json()) as PackageJson;

const USERSCRIPT_NAME = "Better EH";
const USERSCRIPT_FILE = "better-eh.user.js";
const USERSCRIPT_ICON = "https://api.iconify.design/ph/book-open-bold.svg";
const USERSCRIPT_NAMESPACE = "https://github.com/identity-morphism/better-eh";
const USERSCRIPT_URL = `https://raw.githubusercontent.com/identity-morphism/better-eh/master/dist/${USERSCRIPT_FILE}`;

function makeHeader(): string {
  return `${[
    "// ==UserScript==",
    `// @name         ${USERSCRIPT_NAME}`,
    `// @namespace    ${USERSCRIPT_NAMESPACE}`,
    `// @version      ${pkg.version}`,
    `// @description  ${pkg.description}`,
    "// @author       identity-morphism",
    `// @icon         ${USERSCRIPT_ICON}`,
    `// @updateURL    ${USERSCRIPT_URL}`,
    `// @downloadURL  ${USERSCRIPT_URL}`,
    "// @match        https://e-hentai.org/*",
    "// @match        https://exhentai.org/*",
    "// @noframes",
    "// @grant        GM_addStyle",
    "// @grant        GM_getValue",
    "// @grant        GM_setValue",
    "// @grant        GM_registerMenuCommand",
    "// @run-at       document-start",
    "// @license      MIT",
    "// ==/UserScript==",
  ].join("\n")}\n\n`;
}

function buildTailwind(): void {
  mkdirSync(join(import.meta.dir, ".cache"), { recursive: true });
  // Sleazy Fork rejects minified scripts; keep the generated CSS readable as well as the JS.
  const result = Bun.spawnSync({
    cmd: [
      join(import.meta.dir, "node_modules/.bin/tailwindcss"),
      "-i",
      "./src/tailwind.css",
      "-o",
      "./.cache/app.css",
    ],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    process.exit(1);
  }
  console.log(
    `[${new Date().toLocaleTimeString()}] Tailwind: ${Bun.file("./.cache/app.css").size} bytes`,
  );
}

/**
 * The bundle is published exactly as Bun prints it.
 *
 * Sleazy Fork requires unminified output, and Bun's printer already keeps names and statement
 * breaks, so a formatter pass would only re-wrap lines: measured at ~11% more lines and ~9 KB for
 * this script. Skipping it also drops a subprocess and any drift between Bun's formatter versions.
 */
async function build(header: string): Promise<void> {
  buildTailwind();
  const result = await Bun.build({
    entrypoints: ["./src/main.ts"],
    outdir: "./dist",
    naming: USERSCRIPT_FILE,
    minify: false,
    target: "browser",
    // Scope the bundle: top-level declarations would otherwise land on `window`,
    // where they leak into (and collide with) the page's own globals.
    format: "iife",
  });

  if (!result.success) {
    console.error("Build failed", result.logs);
    process.exit(1);
  }

  const bundlePath = `./dist/${USERSCRIPT_FILE}`;
  const output = result.outputs[0];
  if (!output) {
    throw new Error("Bun.build produced no output");
  }
  const code = await output.text();
  const lines = code.split("\n").length;
  console.log(`[${new Date().toLocaleTimeString()}] Bundled: ${code.length} bytes, ${lines} lines`);

  await Bun.write(bundlePath, header + code);
  console.log(`[${new Date().toLocaleTimeString()}] Build complete.`);
}

const header = makeHeader();
const args = process.argv.slice(2);
const shouldWatch = args.includes("--watch");
const shouldServe = args.includes("--serve");

/** Dev-server port from `--port <n>`, `--port=<n>`, `PORT=<n>`, else 8080. */
function resolvePort(): number {
  const flag = args.find((arg) => arg === "--port" || arg.startsWith("--port="));
  const raw = !flag
    ? process.env.PORT
    : flag.includes("=")
      ? flag.slice("--port=".length)
      : args[args.indexOf(flag) + 1];
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : 8080;
}

await build(header);

if (shouldWatch) {
  console.log("Watching for changes in src/...");
  let buildTimeout: ReturnType<typeof setTimeout> | undefined;
  watch(join(import.meta.dir, "src"), { recursive: true }, (_event, filename) => {
    if (!filename) {
      return;
    }
    clearTimeout(buildTimeout);
    buildTimeout = setTimeout(() => {
      console.log(`[${new Date().toLocaleTimeString()}] Change: ${filename}`);
      void build(header);
    }, 150);
  });
}

if (shouldServe) {
  const port = resolvePort();
  try {
    Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === `/${USERSCRIPT_FILE}`) {
          return new Response(Bun.file(`./dist/${USERSCRIPT_FILE}`), {
            headers: {
              "Content-Type": "application/javascript",
              "Access-Control-Allow-Origin": "*",
              // Violentmonkey re-fetches this URL every ~500ms while tracking edits.
              "Cache-Control": "no-store",
            },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
  } catch (error) {
    console.error(
      `Cannot serve on port ${port}: ${(error as Error).message}\n` +
        `Use --port <n> or PORT=<n> to pick another port.`,
    );
    process.exit(1);
  }
  console.log(`Server running at http://localhost:${port}/${USERSCRIPT_FILE}`);
}
