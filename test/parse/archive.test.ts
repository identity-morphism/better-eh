import { describe, expect, test } from "bun:test";

import { parseArchiveDownloadHref, parseArchivePage } from "../../src/parse/archive";
import { loadFixture, parseDocument } from "../dom";

const ARCHIVE_URL = "https://e-hentai.org/archiver.php?gid=123456&token=abcdef1234&or=fake-or-key";

const doc = await loadFixture("archive.html");
const data = parseArchivePage(doc, ARCHIVE_URL);

describe("parseArchivePage", () => {
  test("reads the title, balance and both download forms", () => {
    expect(data.title).toBe("Test Gallery");
    expect(data.funds).toEqual({ gp: "1,234", credits: "5,678" });
    expect(data.galleryHref).toBe("/g/123456/abcdef1234/");
    expect(data.torrentsHref).toBe("/gallerytorrents.php?gid=123456&t=abcdef1234");
  });

  test("reads the original archive price, size and form target", () => {
    expect(data.original).toEqual({
      kind: "original",
      dltype: "org",
      label: "Download Original Archive",
      action: ARCHIVE_URL,
      cost: { kind: "gp", amount: 8800 },
      size: "18.46 MiB",
      available: true,
    });
  });

  test("reads the resampled archive price and size", () => {
    expect(data.resample).toEqual({
      kind: "resample",
      dltype: "res",
      label: "Download Resample Archive",
      action: ARCHIVE_URL,
      cost: { kind: "gp", amount: 218 },
      size: "2.17 MiB",
      available: true,
    });
  });

  test("treats a disabled submit as unavailable", () => {
    const page = parseDocument(`<!doctype html><html><body><div id="db">
      <h1>Gallery</h1>
      <div>
        <div>Download Cost: &nbsp; <strong>N/A</strong></div>
        <form action="/archiver.php?gid=1&amp;token=aa" method="post">
          <input type="hidden" name="dltype" value="res" />
          <input type="submit" name="dlcheck" value="Download Resample Archive" disabled="disabled" />
        </form>
        <p>Estimated Size: &nbsp; <strong>N/A</strong></p>
      </div>
    </div></body></html>`);

    const parsed = parseArchivePage(page, "https://e-hentai.org/archiver.php?gid=1&token=aa");
    expect(parsed.resample?.cost).toEqual({ kind: "unavailable" });
    expect(parsed.resample?.size).toBeNull();
    expect(parsed.resample?.available).toBe(false);
  });

  test("classifies free, insufficient and unrecognised prices", () => {
    const page = parseDocument(`<!doctype html><html><body><div id="db">
      <h1>Gallery</h1>
      <div id="one">
        <div>Download Cost: &nbsp; <strong>Free!</strong></div>
        <form action="/archiver.php?gid=1&amp;token=aa"><input type="hidden" name="dltype" value="org" /><input type="submit" name="dlcheck" value="Download Original Archive" /></form>
        <p>Estimated Size: &nbsp; <strong>1 MiB</strong></p>
      </div>
      <div id="two">
        <div>Download Cost: &nbsp; <strong>Insufficient Funds</strong></div>
        <form action="/archiver.php?gid=1&amp;token=aa"><input type="hidden" name="dltype" value="res" /><input type="submit" name="dlcheck" value="Download Resample Archive" /></form>
        <p>Estimated Size: &nbsp; <strong>2 MiB</strong></p>
      </div>
    </div></body></html>`);

    const parsed = parseArchivePage(page, "https://e-hentai.org/archiver.php?gid=1&token=aa");
    expect(parsed.original?.cost).toEqual({ kind: "free" });
    expect(parsed.original?.available).toBe(true);
    expect(parsed.resample?.cost).toEqual({ kind: "insufficient" });
    expect(parsed.resample?.available).toBe(false);

    const unknown = parseArchivePage(
      parseDocument(`<!doctype html><html><body><div id="db"><h1>Gallery</h1>
        <div><div>Download Cost: &nbsp; <strong>Ask staff</strong></div>
        <form action="/archiver.php?gid=1&amp;token=aa"><input type="hidden" name="dltype" value="org" /><input type="submit" name="dlcheck" value="Download Original Archive" /></form>
        <p>Estimated Size: &nbsp; <strong>1 MiB</strong></p></div></div></body></html>`),
      "https://e-hentai.org/archiver.php?gid=1&token=aa",
    );
    expect(unknown.original?.cost).toEqual({ kind: "unknown", text: "Ask staff" });
    expect(unknown.original?.available).toBe(false);
  });

  test("omits gallery links when the query is not a complete gallery", () => {
    const parsed = parseArchivePage(doc, "https://e-hentai.org/archiver.php?gid=not-a-number");
    expect(parsed.galleryHref).toBeNull();
    expect(parsed.torrentsHref).toBeNull();
  });
});

describe("parseArchiveDownloadHref", () => {
  test("reads the prepared link from the confirmation page", () => {
    const confirmation = parseDocument(`<!doctype html><html><body><div id="db">
      <p>Locating archive server and preparing file for download...</p>
      <p id="continue">(<a href="https://example.hath.network/archive/fake.zip?start=1">Click here if your browser does not continue automatically</a>)</p>
      <p>[ <a href="javascript:window.close()">Close</a> ]</p>
    </div></body></html>`);

    expect(parseArchiveDownloadHref(confirmation, ARCHIVE_URL)).toBe(
      "https://example.hath.network/archive/fake.zip?start=1",
    );
  });

  test("rejects a confirmation without a usable link", () => {
    expect(parseArchiveDownloadHref(doc, ARCHIVE_URL)).toBeNull();
    const script = parseDocument(
      '<html><body><div id="db"><p id="continue"><a href="javascript:void(0)">x</a></p></div></body></html>',
    );
    expect(parseArchiveDownloadHref(script, ARCHIVE_URL)).toBeNull();
  });
});
