import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { LoginRequiredError } from "../../src/fetch/errors";
import { isLoginWall, postForm } from "../../src/net/http";
import { getSettings, updateSettings } from "../../src/settings";

/** The site's login page: a session that died between load and submit gets this with HTTP 200. */
const LOGIN_PAGE = `<!doctype html>
<html><body>
  <form method="post" action="https://forums.e-hentai.org/index.php?act=Login&amp;CODE=01">
    <input type="text" name="UserName" />
    <input type="password" name="PassWord" />
    <input type="submit" value="Log me in" />
  </form>
</body></html>`;

const GALLERY_PAGE = `<!doctype html>
<html><body>
  <div id="gdt">Posted</div>
  <a href="https://forums.e-hentai.org/index.php?act=Login">Login</a>
</body></html>`;

/** The body the next queued request returns. */
const reply = { body: GALLERY_PAGE };

const OPTIONS = { tag: "test", failure: "Request failed" };

// The real queue reads these; zero keeps the two posts from waiting on the request interval.
const originalInterval = getSettings().netIntervalMs;

beforeAll(() => {
  updateSettings({ netIntervalMs: 0 });
});

afterAll(() => {
  updateSettings({ netIntervalMs: originalInterval });
});

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // Stub the transport, not `net/http`: a `mock.module` registration outlives the file and would
  // replace the real functions for every later test in a shared `bun test` process.
  globalThis.fetch = (() => Promise.resolve(new Response(reply.body))) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("login wall detection", () => {
  test("recognises the site's login form", () => {
    expect(isLoginWall(LOGIN_PAGE)).toBe(true);
    expect(isLoginWall('<input name="PassWord" type=password>')).toBe(true);
  });

  test("leaves a real page alone, even when it links to login", () => {
    expect(isLoginWall(GALLERY_PAGE)).toBe(false);
    expect(isLoginWall("<p>Login to post comments.</p>")).toBe(false);
    expect(isLoginWall('{"error":"not signed in"}')).toBe(false);
  });
});

describe("form posts", () => {
  test("a mutation that meets the login wall fails instead of reporting success", async () => {
    reply.body = LOGIN_PAGE;

    await expect(
      postForm(
        "https://e-hentai.org/uconfig.php",
        new URLSearchParams({ apply: "Apply" }),
        OPTIONS,
      ),
    ).rejects.toBeInstanceOf(LoginRequiredError);
  });

  test("a real response still resolves, and the caller can read its body", async () => {
    reply.body = GALLERY_PAGE;

    const response = await postForm(
      "https://e-hentai.org/uconfig.php",
      new URLSearchParams({ apply: "Apply" }),
      OPTIONS,
    );

    expect(await response.text()).toContain("gdt");
  });
});
