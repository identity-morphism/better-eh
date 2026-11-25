import { beforeEach, describe, expect, test } from "bun:test";

import type { GalleryData } from "../../src/types";
import type { GalleryViewDeps } from "../../src/views/gallery";
import { loadFixture } from "../dom";
import { until } from "./async";
import { GALLERY_URL, mountGallery, renderGalleryAt } from "./gallery-harness";

function submit(form: HTMLFormElement | null): void {
  if (!form) {
    throw new Error("missing edit form");
  }
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

describe("comment editing", () => {
  let host: HTMLElement;
  let data: GalleryData;

  beforeEach(async () => {
    ({ host, data } = await mountGallery({ fixture: "gallery-comments.html" }));
  });

  function render(deps: GalleryViewDeps = {}, source = data): void {
    renderGalleryAt(host, source, undefined, deps);
  }

  test("offers Edit only on the author's comment and only when signed in", () => {
    render();
    const own = host.querySelector('.comment[data-comment-id="9001"]');
    const other = host.querySelector('.comment[data-comment-id="0"]');
    expect(own?.querySelector(".comment-edit")).not.toBeNull();
    expect(other?.querySelector(".comment-edit")).toBeNull();

    render({}, { ...data, apiConfig: null });
    expect(host.querySelector(".comment-edit")).toBeNull();
  });

  test("saves through the native endpoint and re-renders the updated body and score", async () => {
    const calls: Array<[string, number, string]> = [];
    const updatedDoc = await loadFixture("gallery-comments.html");
    const updatedBody = updatedDoc.querySelector("#comment_9001");
    const updatedScore = updatedDoc.querySelector("#comment_score_9001");
    if (!updatedBody || !updatedScore) {
      throw new Error("updated fixture lost its comment");
    }
    updatedBody.textContent = "Revised body";
    updatedScore.textContent = "+9";
    let loads = 0;

    render({
      editComment: (url, commentId, text) => {
        calls.push([url, commentId, text]);
        return Promise.resolve();
      },
      loadDocument: () => {
        loads++;
        return Promise.resolve({ doc: updatedDoc, url: GALLERY_URL });
      },
    });

    host
      .querySelector<HTMLButtonElement>('.comment[data-comment-id="9001"] .comment-edit')
      ?.click();
    const textarea = host.querySelector<HTMLTextAreaElement>(".comment-edit-form textarea");
    expect(textarea?.value).toBe("Great work's pacing");
    if (textarea) {
      textarea.value = "Revised body";
    }
    submit(host.querySelector<HTMLFormElement>(".comment-edit-form"));

    await until(() => loads === 1, 100);
    expect(calls).toEqual([[GALLERY_URL, 9001, "Revised body"]]);

    await until(
      () =>
        host.querySelector('.comment[data-comment-id="9001"] .comment-body')?.textContent ===
        "Revised body",
      100,
    );
    expect(host.querySelector('.comment[data-comment-id="9001"] .comment-score')?.textContent).toBe(
      "+9",
    );
  });

  test("Cancel restores the comment without saving", () => {
    const calls: number[] = [];
    render({
      editComment: (_url, commentId) => {
        calls.push(commentId);
        return Promise.resolve();
      },
    });

    host
      .querySelector<HTMLButtonElement>('.comment[data-comment-id="9001"] .comment-edit')
      ?.click();
    const textarea = host.querySelector<HTMLTextAreaElement>(".comment-edit-form textarea");
    if (textarea) {
      textarea.value = "Discard me";
    }
    const cancel = [...host.querySelectorAll<HTMLButtonElement>(".comment-edit-form button")].find(
      (button) => button.textContent === "Cancel",
    );
    cancel?.click();

    expect(host.querySelector(".comment-edit-form")).toBeNull();
    expect(host.querySelector('.comment[data-comment-id="9001"] .comment-body')?.textContent).toBe(
      "Great work's pacing",
    );
    expect(calls).toEqual([]);
  });

  test("keeps the editor and reports a failed save", async () => {
    render({ editComment: () => Promise.reject(new Error("network down")) });

    host
      .querySelector<HTMLButtonElement>('.comment[data-comment-id="9001"] .comment-edit')
      ?.click();
    const textarea = host.querySelector<HTMLTextAreaElement>(".comment-edit-form textarea");
    if (textarea) {
      textarea.value = "Will fail";
    }
    submit(host.querySelector<HTMLFormElement>(".comment-edit-form"));

    await until(() => host.querySelector(".comment-status")?.textContent === "Save failed.", 100);
    expect(host.querySelector(".comment-edit-form")).not.toBeNull();
    expect(host.querySelector<HTMLTextAreaElement>(".comment-edit-form textarea")?.value).toBe(
      "Will fail",
    );
  });
});
