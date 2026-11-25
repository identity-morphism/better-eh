/**
 * Remove the legacy site's ad loader before its script can run.
 *
 * The reskin owns the body, but the original head still carries `jads.js`. Its tag is removed as
 * soon as the parser inserts it, which keeps the script from executing and stops the cascade of
 * `adshow.php` requests. The first external fetch may already be in flight; a userscript cannot
 * cancel the parser's request, only the execution and everything after it.
 */

const SITE_AD_SELECTOR = 'script[src*="juicyads.com"], iframe[src*="juicyads.com"]';

/** Elements whose `src` can turn them into a site ad after insertion. */
function canCarrySiteAd(element: Element): boolean {
  const tag = element.localName;
  return tag === "script" || tag === "iframe";
}

/** Remove matching script and iframe nodes under `root`. */
export function stripSiteAds(root: ParentNode): void {
  for (const node of root.querySelectorAll(SITE_AD_SELECTOR)) {
    node.remove();
  }
}

interface SiteAdBlockOptions {
  /** MutationObserver to use; tests pass a fake. */
  Observer?: typeof MutationObserver;
}

/**
 * Strip existing ad nodes and keep stripping ones the legacy scripts add later.
 *
 * Added nodes are collected per mutation callback and stripped with one scan over the document
 * (their leaves are checked directly), so a feed append does not pay a `querySelectorAll` per
 * subtree. Attribute records only matter for script and iframe nodes, whose `src` decides whether
 * they are ads; checking every mutated element would run `matches` for unrelated attributes.
 *
 * Returns a disposer; the page keeps the observer for its lifetime, tests use it to clean up.
 */
export function blockSiteAds(
  doc: Document = document,
  options: SiteAdBlockOptions = {},
): () => void {
  stripSiteAds(doc);

  const Observer =
    options.Observer ?? doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (typeof Observer !== "function") {
    return () => undefined;
  }

  const observer = new Observer((mutations) => {
    const roots: Element[] = [];
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (target.nodeType !== 1) {
          continue;
        }
        const element = target as Element;
        if (!canCarrySiteAd(element)) {
          continue;
        }
        if (element.matches(SITE_AD_SELECTOR)) {
          element.remove();
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) {
          continue;
        }
        const element = node as Element;
        if (element.matches(SITE_AD_SELECTOR)) {
          element.remove();
        } else {
          roots.push(element);
        }
      }
    }
    if (roots.length === 0) {
      return;
    }
    // One query for the whole batch. Results outside an added root cannot come from this batch,
    // so the containment check keeps the observer's scope exactly the added subtrees.
    for (const node of doc.querySelectorAll(SITE_AD_SELECTOR)) {
      if (roots.some((root) => root === node || root.contains(node))) {
        node.remove();
      }
    }
    // A root detached before the callback ran is not in the document query; scan those alone so
    // an added-then-removed subtree is still stripped.
    for (const root of roots) {
      if (!root.isConnected) {
        stripSiteAds(root);
      }
    }
  });
  observer.observe(doc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  return () => observer.disconnect();
}
