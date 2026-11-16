/**
 * Remove the legacy site's ad loader before its script can run.
 *
 * The reskin owns the body, but the original head still carries `jads.js`. Its tag is removed as
 * soon as the parser inserts it, which keeps the script from executing and stops the cascade of
 * `adshow.php` requests. The first external fetch may already be in flight; a userscript cannot
 * cancel the parser's request, only the execution and everything after it.
 */

const SITE_AD_SELECTOR = 'script[src*="juicyads.com"], iframe[src*="juicyads.com"]';

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

  const strip = (node: Node): void => {
    if (node.nodeType !== 1) {
      return;
    }
    const element = node as Element;
    if (element.matches(SITE_AD_SELECTOR)) {
      element.remove();
      return;
    }
    stripSiteAds(element);
  };

  const observer = new Observer((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target;
        if (target.nodeType === 1 && (target as Element).matches(SITE_AD_SELECTOR)) {
          (target as Element).remove();
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        strip(node);
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
