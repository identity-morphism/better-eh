import { beforeEach, describe, expect, test } from "bun:test";

import type { GalleryData } from "../../src/types";
import type { GalleryViewDeps } from "../../src/views/gallery";
import { loadFixture } from "../dom";
import { until } from "./async";
import { GALLERY_URL, mountGallery, renderGalleryAt } from "./gallery-harness";

interface ApiCall {
  url: string;
  body: unknown;
}

function recorder(): { calls: ApiCall[]; post: (url: string, body: unknown) => Promise<unknown> } {
  const calls: ApiCall[] = [];
  return {
    calls,
    post: (url, body) => {
      calls.push({ url, body });
      return Promise.resolve({});
    },
  };
}

describe("gallery parity actions", () => {
  let host: HTMLElement;
  let data: GalleryData;

  beforeEach(async () => {
    ({ host, data } = await mountGallery({ fixture: "gallery-comments.html" }));
  });

  function render(deps: GalleryViewDeps = {}): void {
    renderGalleryAt(host, data, undefined, deps);
  }

  test("rating posts stars times two once and then thanks the user", async () => {
    const api = recorder();
    api.post = (url, body) => {
      api.calls.push({ url, body });
      return Promise.resolve({ rating_avg: 4.61, rating_cnt: 10, rating_usr: 5 });
    };
    render({ post: api.post });

    const halves = [...host.querySelectorAll<HTMLButtonElement>(".rating-half")];
    expect(halves).toHaveLength(10);
    halves[5]?.click();
    halves[5]?.click();
    await until(
      () => host.querySelector(".rating-label")?.textContent === "Thanks for rating!",
      50,
    );

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.url).toBe("https://api.e-hentai.org/api.php");
    expect(api.calls[0]?.body).toEqual({
      method: "rategallery",
      apiuid: "777",
      apikey: "key123",
      gid: "123456",
      token: "abcdef1234",
      rating: 6,
    });
    expect(host.querySelector(".rating-label")?.textContent).toBe("Thanks for rating!");
    expect(host.querySelector(".rating-count")?.textContent).toBe("10 votes");
  });

  test("coarse pointers rate whole stars with full-star targets", async () => {
    const api = recorder();
    api.post = (url, body) => {
      api.calls.push({ url, body });
      return Promise.resolve({ rating_avg: 4.61, rating_cnt: 10, rating_usr: 4 });
    };
    const original = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({ matches: query === "(any-pointer: coarse)", media: query }),
    });
    try {
      render({ post: api.post });
      const stars = [...host.querySelectorAll<HTMLButtonElement>("button.rating-star")];
      expect(stars).toHaveLength(5);
      expect(host.querySelectorAll("button.rating-half")).toHaveLength(0);
      // Each target still carries two half cells so fractional averages paint exactly.
      expect(stars.map((star) => star.querySelectorAll(".rating-half").length)).toEqual([
        2, 2, 2, 2, 2,
      ]);

      stars[3]?.click();
      await until(
        () => host.querySelector(".rating-label")?.textContent === "Thanks for rating!",
        50,
      );

      expect(api.calls[0]?.body).toMatchObject({ rating: 8 });
      expect(stars.map((star) => star.getAttribute("aria-pressed"))).toEqual([
        "true",
        "true",
        "true",
        "true",
        "false",
      ]);
    } finally {
      if (original) {
        Object.defineProperty(window, "matchMedia", original);
      } else {
        delete (window as unknown as Record<string, unknown>).matchMedia;
      }
    }
  });

  test("shows the viewer's half-star rating and votes in half steps", async () => {
    const api = recorder();
    api.post = (url, body) => {
      api.calls.push({ url, body });
      return Promise.resolve({ rating_avg: 4.61, rating_cnt: 10, rating_usr: 2.5 });
    };
    render({ post: api.post });

    const halves = [...host.querySelectorAll<HTMLButtonElement>(".rating-half")];
    expect(halves.map((half) => half.classList.contains("is-on"))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
    ]);

    halves[4]?.click();
    await until(
      () => host.querySelector(".rating-label")?.textContent === "Thanks for rating!",
      50,
    );

    expect(api.calls[0]?.body).toEqual({
      method: "rategallery",
      apiuid: "777",
      apikey: "key123",
      gid: "123456",
      token: "abcdef1234",
      rating: 5,
    });
    // Five lit halves after the server confirms 2.5 stars.
    expect(
      [...host.querySelectorAll(".rating-half")].filter((half) => half.classList.contains("is-on")),
    ).toHaveLength(5);
  });

  test("a failed rating is reported in the control", async () => {
    render({ post: () => Promise.reject(new Error("Vote limit reached")) });

    host.querySelectorAll<HTMLButtonElement>(".rating-half")[0]?.click();
    await until(() => host.querySelector(".rating-label")?.textContent === "Rating failed.", 50);

    expect(host.querySelector(".rating-label")?.textContent).toBe("Rating failed.");
    expect(document.getElementById("eh-toast")?.textContent).toBe("Vote limit reached");
  });

  test("comment voting posts the comment id and updates the score", async () => {
    const api = recorder();
    api.post = (url, body) => {
      api.calls.push({ url, body });
      return Promise.resolve({ comment_id: 9001, comment_score: 8, comment_vote: 1 });
    };
    render({ post: api.post });

    const card = host.querySelector<HTMLElement>('[data-comment-id="9001"]');
    card?.querySelector<HTMLButtonElement>(".comment-vote-up")?.click();
    await until(() => card?.querySelector(".comment-score")?.textContent === "+8", 50);

    expect(api.calls[0]?.body).toEqual({
      method: "votecomment",
      apiuid: "777",
      apikey: "key123",
      gid: "123456",
      token: "abcdef1234",
      comment_id: 9001,
      comment_vote: 1,
    });
    expect(card?.querySelector(".comment-score")?.textContent).toBe("+8");
    expect(card?.querySelector(".comment-vote-up")?.getAttribute("aria-pressed")).toBe("true");
  });

  test("posting a comment submits the form and renders the refetched comment", async () => {
    const updated = await loadFixture("gallery-comments.html");
    const template = updated.querySelectorAll("#cdiv .c1")[1];
    if (!template) {
      throw new Error("fixture is missing the second comment");
    }
    const clone = template.cloneNode(true) as HTMLElement; // cloning an element yields an element
    for (const node of clone.querySelectorAll<HTMLElement>("[id]")) {
      node.id = node.id.replace("9001", "9002");
    }
    const body = clone.querySelector<HTMLElement>("#comment_9002");
    if (body) {
      body.textContent = "Fresh from the server";
    }
    updated.getElementById("cdiv")?.insertBefore(clone, updated.getElementById("formdiv"));

    const submitted: Array<{ url: string; text: string }> = [];
    const loads: string[] = [];
    render({
      postComment: (url, text) => {
        submitted.push({ url, text });
        return Promise.resolve();
      },
      loadDocument: (url) => {
        loads.push(url);
        return Promise.resolve({ doc: updated, url });
      },
    });

    const textarea = host.querySelector<HTMLTextAreaElement>("textarea[name='commenttext_new']");
    expect(textarea).not.toBeNull();
    if (textarea) {
      textarea.value = "Nice pacing";
    }
    host
      .querySelector("form.comment-composer")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => host.querySelector(".comments-title")?.textContent === "Comments (3)", 50);

    expect(submitted).toEqual([{ url: GALLERY_URL, text: "Nice pacing" }]);
    expect(loads).toEqual([GALLERY_URL]);
    expect(host.querySelector(".comments-title")?.textContent).toBe("Comments (3)");
    expect([...host.querySelectorAll(".comment-body")].map((node) => node.textContent)).toContain(
      "Fresh from the server",
    );
  });

  test("the tag menu votes, closes, and refreshes the tag list", async () => {
    const api = recorder();
    const loads: string[] = [];
    const doc = await loadFixture("gallery-comments.html");
    render({
      post: (url, body) => {
        api.calls.push({ url, body });
        return Promise.resolve({});
      },
      loadDocument: (url) => {
        loads.push(url);
        return Promise.resolve({ doc, url });
      },
    });

    const chip = host.querySelector<HTMLAnchorElement>(".tag-chip");
    const opened = chip?.dispatchEvent(
      new Event("contextmenu", { bubbles: true, cancelable: true }),
    );
    // The browser menu is suppressed so ours can take its place.
    expect(opened).toBe(false);
    const menu = document.querySelector<HTMLElement>(".tag-menu");
    expect(menu).not.toBeNull();
    expect(menu?.querySelector(".tag-menu-title")?.textContent).toBe("alice");
    expect(menu?.querySelector(".tag-menu-ns")?.textContent).toBe("artist");
    expect(menu?.querySelectorAll(".tag-menu-divider")).toHaveLength(2);
    expect(menu?.querySelector("input[name='new_tags']")).not.toBeNull();

    const voteUp = [...document.querySelectorAll<HTMLButtonElement>(".tag-menu-item")].find(
      (node) => node.textContent === "Vote up",
    );
    voteUp?.click();
    await until(() => document.querySelector(".tag-menu-panel") === null && loads.length === 1, 50);

    expect(api.calls[0]?.body).toEqual({
      method: "taggallery",
      apiuid: "777",
      apikey: "key123",
      gid: "123456",
      token: "abcdef1234",
      tags: "artist:alice",
      vote: 1,
    });
    expect(document.querySelector(".tag-menu-panel")).toBeNull();
    expect(loads).toEqual([GALLERY_URL]);
  });

  test("the tag box adds tags and refreshes the tag list", async () => {
    const api = recorder();
    const loads: string[] = [];
    const doc = await loadFixture("gallery-comments.html");
    render({
      post: (url, body) => {
        api.calls.push({ url, body });
        return Promise.resolve({});
      },
      loadDocument: (url) => {
        loads.push(url);
        return Promise.resolve({ doc, url });
      },
    });

    const form = host.querySelector<HTMLFormElement>("form.tag-add");
    const input = form?.querySelector<HTMLInputElement>("input[name='new_tags']");
    expect(form).not.toBeNull();
    if (!form || !input) {
      throw new Error("the tag box is missing");
    }
    input.value = "female:glasses, sole female";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await until(() => loads.length === 1 && input.value === "", 50);

    expect(api.calls[0]?.body).toEqual({
      method: "taggallery",
      apiuid: "777",
      apikey: "key123",
      gid: "123456",
      token: "abcdef1234",
      tags: "female:glasses, sole female",
      vote: 1,
    });
    expect(loads).toEqual([GALLERY_URL]);
  });

  test("renders the site actions as a rail instead of a hidden menu", () => {
    render();

    const links = [...host.querySelectorAll<HTMLAnchorElement>(".gallery-rail .rail-link")];
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://e-hentai.org/archiver.php?gid=123456&token=abcdef1234",
      "https://e-hentai.org/gallerytorrents.php?gid=123456&t=abcdef1234",
      "https://e-hentai.org/g/123456/abcdef1234/?report=select",
      "https://e-hentai.org/g/123456/abcdef1234/?act=expunge",
      "https://e-hentai.org/gallerypopups.php?gid=123456&t=abcdef1234&act=rename",
      `https://e-hentai.org/g/123456/abcdef1234/?eh_native=1`,
    ]);
    for (const link of links) {
      // The archive chooser and the gallery torrent list are owned now; the other site actions
      // still leave the shell.
      const owned =
        link.getAttribute("href")?.includes("gallerytorrents.php") === true ||
        link.getAttribute("href")?.includes("archiver.php") === true;
      expect(link.getAttribute("data-native")).toBe(owned ? null : "");
    }
    expect(host.querySelector(".gallery-rail")?.getAttribute("aria-label")).toBe("Site actions");
  });

  test("stars rest on the gallery average until the viewer rates", async () => {
    data = { ...data, ratingInfo: { average: 3, votes: 5, user: null } };
    const api = recorder();
    render({ post: api.post });

    expect(host.querySelector(".rating-label")?.textContent).toBe("Average: 3.00");
    expect(host.querySelectorAll(".rating-half.is-on")).toHaveLength(6);
    // The average is not the viewer's rating, so no half reads as pressed.
    expect(host.querySelectorAll('.rating-half[aria-pressed="true"]')).toHaveLength(0);

    host.querySelectorAll<HTMLButtonElement>(".rating-half")[9]?.click();
    await until(
      () => host.querySelector(".rating-label")?.textContent === "Thanks for rating!",
      50,
    );

    expect(host.querySelectorAll(".rating-half.is-on")).toHaveLength(10);
    expect(host.querySelectorAll('.rating-half[aria-pressed="true"]')).toHaveLength(10);
  });

  test("a saved rating starts as pressed, unlike the average", () => {
    data = { ...data, ratingInfo: { average: 3, votes: 5, user: 4 } };
    render();

    expect(host.querySelector(".rating-label")?.textContent).toBe("Average: 3.00");
    expect(host.querySelectorAll(".rating-half.is-on")).toHaveLength(8);
    expect(host.querySelectorAll('.rating-half[aria-pressed="true"]')).toHaveLength(8);
  });

  test("opens the same menu on right-click over the title", () => {
    render();

    const opened = host
      .querySelector(".gallery-title")
      ?.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));

    expect(opened).toBe(false);
    expect(document.querySelector(".action-menu-panel")).not.toBeNull();
  });

  test("keeps the parent gallery and omits unreported visibility", async () => {
    ({ host, data } = await mountGallery());
    render();

    const parent = host.querySelector<HTMLAnchorElement>(
      ".gallery-meta a.meta-dot[href*='/g/100/']",
    );
    expect(parent?.textContent).toBe("Parent: 100");
    expect(parent?.getAttribute("href")).toBe("https://e-hentai.org/g/100/parentcafe/");
    expect(host.querySelector(".gallery-meta")?.textContent).not.toContain("Visible");
  });

  test("anonymous comments stay readable without voting or composing", () => {
    data = { ...data, apiConfig: null };
    render();

    expect(host.querySelectorAll(".comment")).toHaveLength(2);
    expect(host.querySelectorAll(".comment-vote")).toHaveLength(0);
    expect(host.querySelector(".comment-composer")).toBeNull();
    expect(host.querySelector(".rating-control")).toBeNull();
    host
      .querySelector(".tag-chip")
      ?.dispatchEvent(new Event("contextmenu", { bubbles: true, cancelable: true }));
    expect(document.querySelector(".tag-menu-panel")).toBeNull();
  });

  test("anonymous galleries without site actions keep the native escape hatch", async () => {
    ({ host, data } = await mountGallery());
    render();

    const rail = [...host.querySelectorAll(".gallery-rail .rail-link")];
    expect(rail.map((item) => item.textContent)).toEqual(["Open native page"]);
  });
});
