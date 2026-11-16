import type { GalleryPost } from "../data/gallery-actions";
import { editComment as postCommentEdit, voteComment } from "../data/gallery-actions";
import type { GalleryApiConfig, GalleryComment, GalleryData } from "../types";
import { appendChildren, el } from "./dom";
import { errorText } from "./error-text";
import { showToast } from "./toast";

/** Read a signal without letting control-flow narrowing carry a stale value across an await. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/** Transports and defaults for one comment section render. */
export interface CommentSectionDeps {
  post?: GalleryPost;
  postComment: (url: string, text: string, signal?: AbortSignal) => Promise<void>;
  editComment?: (
    url: string,
    commentId: number,
    text: string,
    signal?: AbortSignal,
  ) => Promise<void>;
  /** Re-read the gallery after a mutation and re-render the comments from the fresh page. */
  refresh: () => Promise<void>;
}

/** Inputs for {@link commentsSection}. */
interface CommentSectionOptions {
  data: GalleryData;
  /** Null on anonymous pages: comments stay readable but cannot be voted on or posted. */
  config: GalleryApiConfig | null;
  deps: CommentSectionDeps;
  signal: AbortSignal;
}

function scoreText(score: number | null): string {
  if (score === null) {
    return "—";
  }
  return score > 0 ? `+${score}` : String(score);
}

function commentCard(
  comment: GalleryComment,
  config: GalleryApiConfig | null,
  deps: CommentSectionDeps,
  signal: AbortSignal,
  edit: (commentId: number, text: string) => Promise<void>,
): HTMLElement {
  const card = el("article", {
    class: comment.uploader ? "comment is-uploader" : "comment",
    "data-comment-id": comment.id,
  });
  const score = el("span", {
    class: "comment-score",
    text: scoreText(comment.score),
    "aria-live": "polite",
  });
  const up = el("button", {
    class: "comment-vote comment-vote-up",
    type: "button",
    title: "Vote up",
    "aria-label": `Vote up ${comment.author || "comment"}`,
    "aria-pressed": "false",
    text: "+",
  });
  const down = el("button", {
    class: "comment-vote comment-vote-down",
    type: "button",
    title: "Vote down",
    "aria-label": `Vote down ${comment.author || "comment"}`,
    "aria-pressed": "false",
    text: "−",
  });
  const voteButtons =
    config === null ? null : el("span", { class: "comment-score-wrap" }, score, up, down);
  const head = el(
    "header",
    { class: "comment-head" },
    comment.authorHref
      ? el("a", {
          class: "comment-author",
          href: comment.authorHref,
          text: comment.author || "Anonymous",
        })
      : el("span", { class: "comment-author", text: comment.author || "Anonymous" }),
    comment.uploader ? el("span", { class: "comment-badge", text: "Uploader" }) : "",
    el("span", { class: "comment-posted", text: comment.posted }),
    config === null ? el("span", { class: "comment-score-wrap" }, score) : voteButtons,
  );

  let pending = false;
  const setPending = (busy: boolean): void => {
    pending = busy;
    card.classList.toggle("is-busy", busy);
    if (busy) {
      card.setAttribute("aria-busy", "true");
    } else {
      card.removeAttribute("aria-busy");
    }
  };

  const cast = async (vote: 1 | -1): Promise<void> => {
    if (pending || config === null) {
      return;
    }
    setPending(true);
    try {
      const result = await voteComment(config, comment.id, vote, { post: deps.post });
      if (signal.aborted) {
        return;
      }
      score.textContent = scoreText(result.score);
      up.setAttribute("aria-pressed", result.vote > 0 ? "true" : "false");
      down.setAttribute("aria-pressed", result.vote < 0 ? "true" : "false");
    } catch (error) {
      if (!signal.aborted) {
        showToast(errorText(error));
      }
    } finally {
      setPending(false);
    }
  };

  if (config !== null) {
    up.addEventListener("click", () => void cast(1), { signal });
    down.addEventListener("click", () => void cast(-1), { signal });
  }

  const body = el("div", { class: "comment-body", text: comment.body });
  const bodyHost = el("div", { class: "comment-body-host" }, body);

  let editing = false;
  let saving = false;
  const editButton =
    config !== null && comment.editable
      ? el("button", {
          class: "comment-edit",
          type: "button",
          text: "Edit",
          "aria-label": `Edit comment by ${comment.author || "Anonymous"}`,
        })
      : null;
  if (editButton) {
    head.append(editButton);
    editButton.addEventListener(
      "click",
      () => {
        if (editing) {
          return;
        }
        editing = true;
        editButton.hidden = true;

        const form = el("form", { class: "comment-edit-form" });
        const textarea = el("textarea", {
          class: "field-input comment-input",
          rows: "3",
          "aria-label": `Edit comment by ${comment.author || "Anonymous"}`,
        });
        textarea.value = comment.body;
        const save = el("button", { class: "btn btn-small", type: "submit", text: "Save" });
        const cancel = el("button", {
          class: "btn btn-ghost btn-small",
          type: "button",
          text: "Cancel",
        });
        const status = el("span", { class: "comment-status", role: "status" });
        form.append(
          textarea,
          el("div", { class: "comment-compose-actions" }, save, cancel, status),
        );
        bodyHost.replaceChildren(form);
        if (typeof textarea.focus === "function") {
          textarea.focus();
        }

        const closeEdit = (): void => {
          editing = false;
          editButton.hidden = false;
          bodyHost.replaceChildren(body);
        };

        cancel.addEventListener(
          "click",
          () => {
            closeEdit();
          },
          { signal },
        );
        form.addEventListener(
          "submit",
          (event) => {
            event.preventDefault();
            const text = textarea.value.trim();
            if (saving) {
              return;
            }
            if (text === "") {
              status.textContent = "Comment cannot be empty.";
              return;
            }
            saving = true;
            save.disabled = true;
            cancel.disabled = true;
            save.textContent = "Saving…";
            status.textContent = "Saving…";

            void (async () => {
              try {
                await edit(comment.id, text);
                if (signal.aborted) {
                  return;
                }
                comment.body = text;
                body.textContent = text;
                editButton.hidden = false;
                editing = false;
                bodyHost.replaceChildren(body);
                showToast("Comment updated");
                try {
                  await deps.refresh();
                } catch (error) {
                  if (!isAborted(signal)) {
                    showToast(errorText(error));
                  }
                }
              } catch (error) {
                if (!signal.aborted) {
                  status.textContent = "Save failed.";
                  showToast(errorText(error));
                }
              } finally {
                saving = false;
                save.disabled = false;
                cancel.disabled = false;
                save.textContent = "Save";
              }
            })();
          },
          { signal },
        );
      },
      { signal },
    );
  }

  appendChildren(card, [
    head,
    bodyHost,
    comment.votes === null ? null : el("div", { class: "comment-votes", text: comment.votes }),
  ]);
  return card;
}

/** Render the comment list and the native comment composer. */
export function commentsSection(options: CommentSectionOptions): HTMLElement {
  const { data, config, deps, signal } = options;
  const section = el("section", { class: "gallery-comments", "aria-label": "Comments" });
  const list = el("div", { class: "comment-list" });
  const edit = deps.editComment ?? postCommentEdit;

  section.append(
    el("h2", { class: "comments-title", text: `Comments (${data.comments.length})` }),
    list,
  );
  for (const comment of data.comments) {
    list.append(
      commentCard(comment, config, deps, signal, (commentId, text) =>
        edit(data.url, commentId, text, signal),
      ),
    );
  }

  if (config === null) {
    return section;
  }

  const form = el("form", { class: "comment-composer" });
  const textarea = el("textarea", {
    class: "field-input comment-input",
    name: "commenttext_new",
    rows: "3",
    placeholder: "Add a comment…",
    "aria-label": "New comment",
  });
  const button = el("button", { class: "btn btn-small", type: "submit", text: "Post comment" });
  const status = el("span", { class: "comment-status", role: "status" });
  form.append(textarea, el("div", { class: "comment-compose-actions" }, button, status));
  section.append(form);

  let posting = false;

  /** Re-render the comments after a post; failure here must not claim the post failed. */
  const refresh = async (): Promise<void> => {
    status.replaceChildren("Posted. Refreshing…");
    try {
      await deps.refresh();
      if (signal.aborted) {
        return;
      }
      status.replaceChildren();
    } catch (error) {
      if (signal.aborted) {
        return;
      }
      status.replaceChildren(
        "Posted, but the page could not refresh. ",
        el("button", {
          class: "comment-retry",
          type: "button",
          text: "Reload",
          onclick: () => {
            void refresh();
          },
        }),
      );
      // The post succeeded but the page did not refresh: put focus on the recovery action so the
      // failure is actionable without hunting for it.
      status.querySelector<HTMLElement>(".comment-retry")?.focus();
      showToast(errorText(error));
    }
  };

  form.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      const text = textarea.value.trim();
      if (posting || text === "") {
        return;
      }
      posting = true;
      // A disabled button loses focus in every browser; the `posting` guard is the real lock.
      button.textContent = "Posting…";
      status.textContent = "Posting…";

      void (async () => {
        try {
          await deps.postComment(data.url, text, signal);
          if (signal.aborted) {
            return;
          }
          textarea.value = "";
          await refresh();
        } catch (error) {
          if (!signal.aborted) {
            status.textContent = "Post failed.";
            showToast(errorText(error));
          }
        } finally {
          posting = false;
          button.textContent = "Post comment";
        }
      })();
    },
    { signal },
  );

  return section;
}
