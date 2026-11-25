import { beforeEach, describe, expect, test } from "bun:test";

import { blockSiteAds, stripSiteAds } from "../src/site-ads";
import { installDom } from "./ui/dom";

class FakeObserver {
  static last: FakeObserver | null = null;

  readonly callback: MutationCallback;
  options: MutationObserverInit | null = null;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeObserver.last = this;
  }

  observe(_target: Node, options?: MutationObserverInit): void {
    this.options = options ?? null;
  }

  disconnect(): void {}

  trigger(mutations: MutationRecord[]): void {
    this.callback(mutations, this as unknown as MutationObserver);
  }
}

function added(...nodes: Node[]): MutationRecord {
  return { type: "childList", addedNodes: nodes } as unknown as MutationRecord;
}

function srcChanged(target: Node): MutationRecord {
  return { type: "attributes", target } as unknown as MutationRecord;
}

function adScript(document: Document): HTMLScriptElement {
  const script = document.createElement("script");
  script.src = "https://adserver.juicyads.com/js/jads.js";
  return script;
}

let doc: Document;

beforeEach(() => {
  doc = installDom();
  FakeObserver.last = null;
});

describe("site ads", () => {
  test("strips ad scripts and iframes already in the document", () => {
    const ad = adScript(doc);
    const app = doc.createElement("script");
    app.src = "https://e-hentai.org/z/app.js";
    doc.head.append(ad, app);

    const frame = doc.createElement("iframe");
    frame.src = "https://adserver.juicyads.com/adshow.php?adzone=1";
    doc.body.append(frame);

    stripSiteAds(doc);

    expect(doc.head.contains(ad)).toBe(false);
    expect(doc.body.contains(frame)).toBe(false);
    expect(doc.head.contains(app)).toBe(true);
  });

  test("removes ad nodes the site adds later, including a subtree and a mutated src", () => {
    blockSiteAds(doc, { Observer: FakeObserver as unknown as typeof MutationObserver });
    const observer = FakeObserver.last;
    if (observer === null) {
      throw new Error("expected the ad observer");
    }
    expect(observer.options).toMatchObject({
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });

    const script = adScript(doc);
    const wrapper = doc.createElement("div");
    const frame = doc.createElement("iframe");
    frame.src = "https://adserver.juicyads.com/adshow.php?adzone=2";
    wrapper.append(frame);
    doc.head.append(script);
    doc.body.append(wrapper);

    observer.trigger([added(script, wrapper)]);

    expect(doc.head.contains(script)).toBe(false);
    expect(doc.body.contains(wrapper)).toBe(true);
    expect(wrapper.contains(frame)).toBe(false);

    const retargeted = doc.createElement("iframe");
    doc.body.append(retargeted);
    retargeted.src = "https://adserver.juicyads.com/adshow.php?adzone=3";
    observer.trigger([srcChanged(retargeted)]);

    expect(doc.body.contains(retargeted)).toBe(false);
  });
});
