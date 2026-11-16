import { describe, expect, test } from "bun:test";

import { isLoginPage, isNotFoundPage } from "../../src/net/http";
import { parseDocument } from "../dom";

function page(title: string, heading?: string): Document {
  const h1 = heading === undefined ? "" : `<h1>${heading}</h1>`;
  return parseDocument(
    `<!doctype html><html><head><title>${title}</title></head><body>${h1}</body></html>`,
  );
}

describe("isNotFoundPage", () => {
  test("matches a gone gallery", () => {
    expect(
      isNotFoundPage(page("Gallery Not Available - E-Hentai Galleries", "Gallery Not Available")),
    ).toBe(true);
  });

  test("matches the plain-text body the site serves for unknown galleries", () => {
    // 172 bytes, no <title>, no <h1>: what /g/<unknown>/ actually returns.
    expect(
      isNotFoundPage(
        parseDocument(
          "<html><body>Gallery not found. If you just added this gallery, you may have to wait a short while before it becomes available.</body></html>",
        ),
      ),
    ).toBe(true);
  });

  test("does not mistake a long gallery body for a missing page", () => {
    const filler = "<p>gallery text</p>".repeat(80);
    const doc = parseDocument(
      `<html><head><title>Some Gallery - E-Hentai Galleries</title></head><body>${filler}</body></html>`,
    );
    expect(isNotFoundPage(doc)).toBe(false);
  });

  test("matches the host's bare 404 document", () => {
    const doc = parseDocument(
      "<html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><p>The requested URL was not found on this server.</p></body></html>",
    );

    expect(isNotFoundPage(doc)).toBe(true);
    expect(isNotFoundPage(page("404 Not Found - E-Hentai Galleries", "Not Found"))).toBe(true);
    expect(isNotFoundPage(page("404 - E-Hentai Galleries", "404"))).toBe(true);
  });

  test("matches either title or heading on its own", () => {
    expect(isNotFoundPage(page("Not Available - E-Hentai Galleries"))).toBe(true);
    expect(isNotFoundPage(page("Some Page - E-Hentai Galleries", "Gallery Not Available"))).toBe(
      true,
    );
    expect(isNotFoundPage(page("", "Not Found"))).toBe(true);
  });

  test("ignores the site suffix and collapsed whitespace", () => {
    expect(
      isNotFoundPage(
        page("Gallery  Not   Available - ExHentai.org", "  Gallery\n  Not  Available  "),
      ),
    ).toBe(true);
  });

  test("leaves real pages alone", () => {
    const doc = parseDocument(
      "<html><head><title>E-Hentai Galleries</title></head><body><h1>Galleries</h1></body></html>",
    );

    expect(isNotFoundPage(doc)).toBe(false);
    expect(isLoginPage(doc)).toBe(false);
    expect(
      isNotFoundPage(
        page(
          "The Great Work - E-Hentai Galleries",
          "[Artist] The Great Work | A Side Story [English]",
        ),
      ),
    ).toBe(false);
  });

  test("does not treat a phrase that merely contains a not-found word as a 404", () => {
    expect(isNotFoundPage(page("Not Available in Stores - E-Hentai Galleries"))).toBe(false);
  });
});

describe("isLoginPage", () => {
  test("does not confuse the login wall with a missing page", () => {
    const doc = parseDocument(
      '<html><head><title>Sad Panda</title></head><body><div id="sadpanda"></div></body></html>',
    );

    expect(isLoginPage(doc)).toBe(true);
    expect(isNotFoundPage(doc)).toBe(false);
  });

  test("does not trust uploader-controlled titles over real page content", () => {
    const sadPandaGallery = parseDocument(
      '<html><head><title>Sad Panda - E-Hentai Galleries</title></head><body><div id="gn">Sad Panda</div><div id="gdt"><div id="gdd"></div></div></body></html>',
    );
    expect(isLoginPage(sadPandaGallery)).toBe(false);

    const notFoundGallery = parseDocument(
      '<html><head><title>Not Found - E-Hentai Galleries</title></head><body><div id="gn">Not Found</div><div id="gdt"><div id="gdd"></div></div></body></html>',
    );
    expect(isNotFoundPage(notFoundGallery)).toBe(false);
  });
});
