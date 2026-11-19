import { describe, expect, test } from "bun:test";

import { ParseMismatchError } from "../../src/fetch/errors";
import { parseHome } from "../../src/parse/home";
import { assertHomePage } from "../../src/parse/sanity";
import { loadFixture, parseDocument } from "../dom";

const HOME_URL = "https://e-hentai.org/home.php";
const doc = await loadFixture("home.html");
const home = parseHome(doc, HOME_URL);

function section(title: string) {
  const found = home.sections.find((entry) => entry.title === title);
  if (found === undefined) {
    throw new Error(`missing the ${title} section`);
  }
  return found;
}

describe("parseHome", () => {
  test("collects the account subnav and marks the current page", () => {
    expect(home.nav.map((link) => link.label)).toEqual([
      "Overview",
      "My Stats",
      "My Settings",
      "My Tags",
      "Hentai@Home",
    ]);
    expect(home.nav.map((link) => link.active)).toEqual([true, false, false, false, false]);
    expect(home.nav[1]?.href).toBe("https://e-hentai.org/stats.php");
  });

  test("keeps each titled account box in page order", () => {
    expect(home.sections.map((entry) => entry.title)).toEqual([
      "Image Limits",
      "EHTracker",
      "Total GP Gained",
      "Toplists",
      "Moderation Power",
    ]);
  });

  test("reads image-limit prose and the native action label", () => {
    const limits = section("Image Limits");
    expect(limits.paragraphs).toEqual([
      "Due to widespread usage of bulk downloaders, high-resolution images can be limited.",
      "Alternatively, you can unlock a high-resolution quota for 24 hours by spending 20,000 GP.",
    ]);
    expect(limits.action).toBe("Unlock Quota");
  });

  test("pairs the tracker's value-first cells with their labels", () => {
    const tracker = section("EHTracker");
    expect(tracker.facts).toEqual([
      { label: "uploaded", value: "12.34 MiB" },
      { label: "downloaded", value: "5.67 GiB" },
      { label: "up/down ratio", value: "0.002" },
      { label: "torrent completes", value: "3" },
      { label: "gallery completes", value: "4" },
      { label: "seedmins", value: "8,726" },
    ]);
    expect(tracker.paragraphs).toContain("Your current key is: TESTKEY123");
    expect(tracker.links).toEqual([
      { label: "Show My Torrents", href: "https://e-hentai.org/torrents.php?u=12345" },
    ]);
    expect(tracker.action).toBe("Reset Torrent Key");
  });

  test("reads the GP rows as value then label", () => {
    expect(section("Total GP Gained").facts).toEqual([
      { label: "GP from gallery visits", value: "120" },
      { label: "GP from torrent completions", value: "30" },
      { label: "GP from archive downloads", value: "0" },
      { label: "GP from Hentai@Home", value: "5" },
    ]);
  });

  test("keeps a one-sentence box as prose", () => {
    expect(section("Toplists").paragraphs).toEqual([
      "You are currently not featured on any toplists...",
    ]);
  });

  test("reads moderation totals and label-first rows", () => {
    expect(section("Moderation Power").facts).toEqual([
      { label: "Current", value: "6" },
      { label: "Base", value: "+1" },
      { label: "Awards", value: "+0" },
      { label: "Tagging", value: "+0" },
      { label: "Level", value: "+0.12" },
      { label: "Account Age", value: "+5" },
    ]);
  });

  test("rejects the login wall instead of rendering an empty overview", () => {
    const login = parseDocument(
      '<html><body><div class="d">This page requires you to log on.</div></body></html>',
    );
    const parsed = parseHome(login, HOME_URL);
    expect(() => assertHomePage(parsed, login)).toThrow(ParseMismatchError);
  });
});
