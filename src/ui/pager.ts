import { el, icon } from "./dom";

/** Numeric page strip data; omitted for single-page or unknown-length listings. */
interface PagerPages {
  current: number;
  total: number;
  href: (page: number) => string;
}

/** Numeric jump control: one-based page numbers, no total required (the site rejects overflow). */
interface PagerJump {
  current: number;
  go: (page: number) => void;
}

/** Date/offset seek for cursor-paginated listings, which have no page numbers. */
interface PagerSeek {
  go: (value: string) => void;
}

/** Links and context text for one pagination bar. */
interface PagerOptions {
  prev: string | null;
  next: string | null;
  /** Context text, e.g. "Showing 1 - 20 of 76 images"; omit when the view header already says it. */
  info?: string;
  label: string;
  /** Renders a numbered strip instead of bare previous/next links. */
  pages?: PagerPages;
  /** Jump directly to a page; shown only when the listing has another page. */
  jump?: PagerJump;
  /** Seek to a date or offset; shown only when the listing has another page. */
  seek?: PagerSeek;
}

/**
 * One-based page number to the site's zero-based `?<param>=` URL.
 *
 * Both the toplist and the torrent index expose their page cursor this way: the first page has no
 * parameter, and every later page stores its zero-based index. `param` is the site's spelling, `p`
 * or `page`.
 */
function pageHref(baseUrl: string, page: number, param: string): string {
  const url = new URL(baseUrl);
  if (page <= 1) {
    url.searchParams.delete(param);
  } else {
    url.searchParams.set(param, String(page - 1));
  }
  return url.href;
}

/** Page numbers to show: the ends, the current page and one neighbour either side. */
function pageWindow(current: number, total: number): readonly (number | null)[] {
  const wanted = new Set<number>([1, total, current - 1, current, current + 1]);
  const pages = [...wanted].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let previous = 0;
  for (const page of pages) {
    if (previous !== 0 && page - previous > 1) {
      out.push(null);
    }
    out.push(page);
    previous = page;
  }
  return out;
}

function numericStrip({ current, total, href }: PagerPages): HTMLElement[] {
  return pageWindow(current, total).map((page) =>
    page === null
      ? el("span", { class: "pager-gap", "aria-hidden": "true", text: "…" })
      : page === current
        ? el(
            "span",
            { class: "pager-num is-current", "aria-current": "page", text: String(page) },
            el("span", { class: "sr-only", text: " (current page)" }),
          )
        : el("a", { class: "pager-num", href: href(page), text: String(page) }),
  );
}

/** Shared shell for the jump and seek controls: label, input, Go and a submit handler. */
function jumpForm(label: string, input: HTMLInputElement, onSubmit: () => void): HTMLFormElement {
  const form = el(
    "form",
    { class: "pager-jump" },
    el("label", { class: "pager-jump-label", text: label }),
    input,
    el("button", { class: "btn btn-small", type: "submit", text: "Go" }),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSubmit();
  });
  return form;
}

/**
 * Build the `nav.pager` shared by every listing view.
 *
 * `prev`/`next` become links when present; a missing direction renders nothing. With `pages` the
 * bar shows a numbered strip instead, so the gallery, favorites, torrent list and search results
 * all paginate through one component and one set of styles. The bar hides itself when it has no
 * link, no numbers and no info, so single-page views do not pay for dead buttons.
 */
export function pager({
  prev,
  next,
  info = "",
  label,
  pages,
  jump,
  seek,
}: PagerOptions): HTMLElement {
  const wrap = el("nav", { class: "pager", "aria-label": label });
  const numbered = pages !== undefined && pages.total > 1;

  if (prev && !numbered) {
    wrap.append(
      el(
        "a",
        { class: "pager-btn", href: prev },
        icon("arrowLeft"),
        el("span", { text: "Previous" }),
      ),
    );
  }

  if (info !== "") {
    wrap.append(el("span", { class: "pager-info", text: info }));
  }

  if (numbered) {
    wrap.append(el("span", { class: "pager-nums" }, ...numericStrip(pages)));
  }

  if (next && !numbered) {
    wrap.append(
      el("a", { class: "pager-btn", href: next }, el("span", { text: "Next" }), icon("arrowRight")),
    );
  }

  const paginated = numbered || prev !== null || next !== null;
  if (jump && paginated) {
    const input = el("input", {
      class: "field-input pager-jump-input",
      type: "number",
      min: 1,
      step: 1,
      inputmode: "numeric",
      value: String(jump.current),
      "aria-label": "Jump to page",
      title: "Jump to page",
    });
    wrap.append(
      jumpForm("Page", input, () => {
        const page = Number.parseInt(input.value, 10);
        if (Number.isFinite(page) && page >= 1) {
          jump.go(page);
        }
      }),
    );
  }

  if (seek && paginated) {
    const input = el("input", {
      class: "field-input pager-jump-input pager-seek-input",
      type: "text",
      placeholder: "date or offset",
      "aria-label": "Seek to a date or offset",
      title: "Enter a year (2020), a date (2020-06-15), or an offset such as 1d, 2w, 3m or 1y.",
    });
    const form = jumpForm("Seek", input, () => {
      const value = input.value.trim();
      if (value !== "") {
        seek.go(value);
      }
    });
    form.classList.add("pager-seek");
    wrap.append(form);
  }

  wrap.hidden = prev === null && next === null && !numbered && info === "";
  return wrap;
}

interface NumberedPagerOptions {
  baseUrl: string;
  /** One-based page the site is showing. */
  page: number;
  total: number;
  /** Site query parameter for the zero-based cursor (`p`, `page`). */
  param: string;
  label: string;
  navigate: (href: string) => void;
  prev?: string | null;
  next?: string | null;
  info?: string;
}

/** The numbered strip plus its jump control, shared by the site's numbered listings. */
export function numberedPager({
  baseUrl,
  page,
  total,
  param,
  label,
  navigate,
  prev = null,
  next = null,
  info = "",
}: NumberedPagerOptions): HTMLElement {
  const href = (target: number): string => pageHref(baseUrl, target, param);
  return pager({
    prev,
    next,
    info,
    label,
    pages: { current: page, total, href },
    jump: { current: page, go: (target) => navigate(href(target)) },
  });
}
