import { describe, expect, mock, test } from "bun:test";

import { LoginRequiredError } from "../../src/fetch/errors";

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

void mock.module("../../src/net/queue", () => ({
  net: {
    fetch: () => Promise.resolve(new Response(reply.body)),
  },
}));

// The queue mock has to be registered before http.ts is evaluated.
const { isLoginWall, postForm } = await import("../../src/net/http");

const OPTIONS = { tag: "test", failure: "Request failed" };

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
