import type { HomePage, HomeSection } from "../parse/home";
import { nativeUrl } from "../routes/identity";
import { el, icon } from "../ui/dom";
import { pageScaffold } from "../ui/page-scaffold";
import type { ViewContext } from "./context";

function navStrip(data: HomePage): HTMLElement | null {
  if (data.nav.length === 0) {
    return null;
  }
  return el(
    "nav",
    { class: "home-nav", "aria-label": "Account pages" },
    ...data.nav.map((link) =>
      el("a", {
        class: link.active ? "home-nav-link is-active" : "home-nav-link",
        href: link.href,
        "aria-current": link.active ? "page" : null,
        text: link.label,
      }),
    ),
  );
}

function sectionCard(section: HomeSection, url: string): HTMLElement {
  const card = el(
    "section",
    { class: "home-section", "aria-label": section.title },
    el("h2", { class: "home-section-title", text: section.title }),
  );

  if (section.facts.length > 0) {
    const facts = el("dl", { class: "home-facts" });
    for (const fact of section.facts) {
      facts.append(
        el(
          "div",
          { class: "home-fact" },
          el("dt", { text: fact.label }),
          el("dd", { text: fact.value }),
        ),
      );
    }
    card.append(facts);
  }

  if (section.paragraphs.length > 0) {
    card.append(
      el(
        "div",
        { class: "home-text" },
        ...section.paragraphs.map((text) => el("p", { class: "home-text-line", text })),
      ),
    );
  }

  if (section.links.length > 0) {
    card.append(
      el(
        "div",
        { class: "home-links" },
        ...section.links.map((link) =>
          el("a", { class: "home-link", href: link.href, text: link.label }),
        ),
      ),
    );
  }

  if (section.action !== null) {
    card.append(
      el(
        "a",
        {
          class: "btn btn-ghost home-action",
          href: nativeUrl(url),
          "data-native": "",
          title: "Open the native My Home page to run this action",
          "aria-label": `${section.action} on the native My Home page`,
        },
        el("span", { text: section.action }),
        icon("external"),
      ),
    );
  }

  return card;
}

/** Render the signed-in account overview. Actions that spend or reset state stay native. */
export function renderHome(host: HTMLElement, data: HomePage, ctx: ViewContext): void {
  pageScaffold(host, {
    title: "My Home",
    summary: [el("span", { text: "Account overview" })],
    signal: ctx.signal,
  });

  const nav = navStrip(data);
  if (nav !== null) {
    host.append(nav);
  }

  host.append(
    el(
      "div",
      { class: "home-sections" },
      ...data.sections.map((section) => sectionCard(section, data.url)),
    ),
  );
}
