import { describe, expect, test } from "bun:test";

import { parseNews } from "../../src/parse/news";
import { loadFixture, parseDocument } from "../dom";

const NEWS_URL = "https://e-hentai.org/news.php";
const doc = await loadFixture("news.html");
const page = parseNews(doc, NEWS_URL);

describe("parseNews", () => {
  test("reads the status and changelog column as titled blocks", () => {
    expect(page.status).toEqual({
      title: "Site Status",
      href: "https://forums.e-hentai.org/index.php?showtopic=274947",
      paragraphs: [
        "Lately we have been seeing a surge of old accounts.",
        "If you still use a weak password, change it.",
        "Scheduled Downtime & Maintenance",
        "No maintenance is currently scheduled.",
      ],
    });
    expect(page.changelog?.title).toBe("Site Changelog");
    expect(page.changelog?.paragraphs).toContain(
      "- Forum avatar uploading has been re-enabled with a new upload handler. You still set it here.",
    );
  });

  test("reads each announcement with its date, body and comment link", () => {
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0]).toEqual({
      title: "New Uploader Servers",
      href: "https://forums.e-hentai.org/index.php?showtopic=301426",
      date: "Posted Wednesday, 30th of September 2026, 06:41 UTC",
      paragraphs: [
        "We will be swapping the uploading servers over the next couple of hours.",
        "The migration was completed. If you are getting a DNS message, go here.",
        "Notable visible changes:",
        "- There is now an AI checkbox.",
      ],
      commentsLabel: "Show 25 comments",
      commentsHref: "https://forums.e-hentai.org/index.php?showtopic=301426",
    });
    expect(page.entries[1]?.paragraphs).toEqual([
      "The Eighteenth Annual E-Hentai Yuletide Lottery",
      "The winner is: moanim (1590897)",
      "The winner is: Yumia Liessfeldt (638489)",
    ]);
  });

  test("tolerates a missing column", () => {
    const empty = parseNews(parseDocument("<html><body></body></html>"), NEWS_URL);
    expect(empty).toEqual({
      url: NEWS_URL,
      status: null,
      changelog: null,
      entries: [],
    });
  });
});
