import { beforeEach, describe, expect, test } from "bun:test";

import type { ArchiveOption, ArchivePage } from "../../src/parse/archive";
import { parseArchivePage } from "../../src/parse/archive";
import { renderArchive } from "../../src/views/archive";
import { loadFixture } from "../dom";
import { deferred, until } from "./async";
import { installDom, mountHost, requireNode, viewContext } from "./dom";

const ARCHIVE_URL = "https://e-hentai.org/archiver.php?gid=123456&token=abcdef1234&or=fake-or-key";

interface StartCall {
  option: ArchiveOption;
  signal: AbortSignal;
}

describe("archive view", () => {
  let host: HTMLElement;
  let data: ArchivePage;
  let started: StartCall[];
  let opened: string[];

  function render(
    overrides: {
      startDownload?: (option: ArchiveOption, signal: AbortSignal) => Promise<string>;
    } = {},
  ): void {
    const ctx = viewContext({ signal: new AbortController().signal });
    renderArchive(host, data, ctx, {
      startDownload:
        overrides.startDownload ??
        ((option, signal) => {
          started.push({ option, signal });
          return Promise.resolve("https://example.hath.network/archive/fake.zip?start=1");
        }),
      openDownload: (href) => {
        opened.push(href);
      },
    });
  }

  beforeEach(async () => {
    const document = installDom(ARCHIVE_URL);
    const fixture = await loadFixture("archive.html");
    data = parseArchivePage(fixture, ARCHIVE_URL);
    host = mountHost(document);
    started = [];
    opened = [];
  });

  test("renders the gallery name, balance, prices, sizes and links", () => {
    render();

    expect(requireNode(host, ".list-heading h1").textContent).toBe("Test Gallery");
    expect(requireNode(host, ".list-summary .badge").textContent).toBe("Archive Download");
    expect(requireNode(host, ".archive-funds").textContent).toBe(
      "Available: 1,234 GP · 5,678 Credits",
    );

    const options = [...host.querySelectorAll(".archive-option")];
    expect(options).toHaveLength(2);
    const first = requireNode(options[0] as Element, ".archive-option-meta");
    expect(requireNode(options[0] as Element, ".archive-option-title").textContent).toBe(
      "Original archive",
    );
    expect(first.textContent).toContain("18.46 MiB");
    expect(first.textContent).toContain("8,800 GP");
    expect(requireNode(options[0] as Element, ".archive-option-note").textContent).toBe(
      "This download spends 8,800 GP when it starts.",
    );
    expect(requireNode(options[1] as Element, ".archive-option-meta").textContent).toContain(
      "2.17 MiB",
    );

    const links = [...host.querySelectorAll<HTMLAnchorElement>(".archive-links a")];
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Back to gallery", "/g/123456/abcdef1234/"],
      ["Torrents", "/gallerytorrents.php?gid=123456&t=abcdef1234"],
    ]);

    const native = requireNode<HTMLAnchorElement>(host, ".archive-footer a");
    expect(native.textContent).toBe("Open native page");
    expect(native.getAttribute("href")).toContain("eh_native=1");
  });

  test("performs the POST, locks both buttons and follows the prepared link", async () => {
    const pending = deferred<string>();
    const ctx = viewContext({ signal: new AbortController().signal });

    renderArchive(host, data, ctx, {
      startDownload: (option, signal) => {
        started.push({ option, signal });
        return pending.promise;
      },
      openDownload: (href) => {
        opened.push(href);
      },
    });

    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".archive-download")];
    buttons[0]?.click();

    expect(started.map((call) => call.option.kind)).toEqual(["original"]);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(requireNode(host, ".archive-option-status").textContent).toBe("Preparing the archive…");

    pending.resolve("https://example.hath.network/archive/fake.zip?start=1");
    await until(() => opened.length === 1);

    expect(opened).toEqual(["https://example.hath.network/archive/fake.zip?start=1"]);
    expect(requireNode(host, ".archive-option-status").textContent).toBe(
      "Archive ready. Starting the download…",
    );
  });

  test("restores the buttons and shows the failure inline", async () => {
    render({
      startDownload: () => Promise.reject(new Error("Archive request failed (500).")),
    });

    const buttons = [...host.querySelectorAll<HTMLButtonElement>(".archive-download")];
    buttons[0]?.click();
    await until(
      () => host.querySelector(".archive-option-status")?.getAttribute("role") === "alert",
    );

    expect(buttons.every((button) => !button.disabled)).toBe(true);
    expect(requireNode(host, ".archive-option-status").textContent).toBe(
      "Archive request failed (500).",
    );
    expect(opened).toHaveLength(0);
  });

  test("does not submit an option the parser could not price", () => {
    data = {
      ...data,
      original:
        data.original === null
          ? null
          : { ...data.original, available: false, cost: { kind: "unknown", text: "" } },
    };
    render();

    const button = requireNode<HTMLButtonElement>(host, ".archive-download");
    expect(button.disabled).toBe(true);
    expect(requireNode(host, ".archive-option-note").textContent).toContain("will not spend GP");
  });
});
