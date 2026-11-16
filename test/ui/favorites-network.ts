import { DOMParser } from "linkedom";

const FOLDERS_HTML = `<!doctype html><html><body>${Array.from(
  { length: 10 },
  (_, slot) => `<input name="favorite_${slot}" value="${slot === 0 ? "Read later" : ""}">`,
).join("")}</body></html>`;

/** The folder lookup and the favorite POST are the only network traffic the menu makes. */
export function stubNetwork(): void {
  Object.assign(globalThis, {
    DOMParser,
    fetch: (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = url.includes("uconfig.php") ? FOLDERS_HTML : "favorites";
      return Promise.resolve(
        new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
      );
    },
  });
}
