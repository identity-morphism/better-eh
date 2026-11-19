import { describe, expect, test } from "bun:test";

import { startArchiveDownload } from "../../src/data/archive";
import type { ArchiveOption } from "../../src/parse/archive";
import { parseDocument } from "../dom";
import { failure } from "../ui/async";

const ACTION = "https://e-hentai.org/archiver.php?gid=123456&token=abcdef1234&or=fake-or-key";

const OPTION: ArchiveOption = {
  kind: "original",
  dltype: "org",
  label: "Download Original Archive",
  action: ACTION,
  cost: { kind: "gp", amount: 8800 },
  size: "18.46 MiB",
  available: true,
};

const CONFIRMATION = `<!doctype html><html><body><div id="db">
  <p>Locating archive server and preparing file for download...</p>
  <p id="continue">(<a href="https://example.hath.network/archive/fake.zip?start=1">Click here</a>)</p>
</div></body></html>`;

describe("startArchiveDownload", () => {
  test("posts the selected form and returns the prepared link", async () => {
    const bodies: URLSearchParams[] = [];
    const urls: string[] = [];

    const href = await startArchiveDownload(OPTION, new AbortController().signal, {
      post: (url, body) => {
        urls.push(url);
        bodies.push(body);
        return Promise.resolve(new Response(CONFIRMATION));
      },
      parseHtml: (html) => parseDocument(html),
    });

    expect(urls).toEqual([ACTION]);
    expect(bodies[0]?.toString()).toBe("dltype=org&dlcheck=Download+Original+Archive");
    expect(href).toBe("https://example.hath.network/archive/fake.zip?start=1");
  });

  test("fails when the confirmation carries no download link", async () => {
    const error = await failure(() =>
      startArchiveDownload(OPTION, new AbortController().signal, {
        post: () => Promise.resolve(new Response("<html><body><div id='db'></div></body></html>")),
        parseHtml: (html) => parseDocument(html),
      }),
    );

    expect(error.message).toBe("The site did not return an archive download link.");
  });
});
