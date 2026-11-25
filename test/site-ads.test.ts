import { beforeEach, describe, expect, test } from "bun:test";

import { blockSiteAds, stripSiteAds } from "../src/site-ads";
import { installDom } from "./ui/dom";

class FakeObserver {
  static last: FakeObserver | null = null;

  readonly callback: MutationCallback;
  options: MutationObserverInit | null = null;
  disconnected = false;

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeObserver.last = this;
  }

  observe(_target: Node, options?: MutationObserverInit): void {
    this.options = options ?? null;
  }

  disconnect(): void {
    this.disconnected = true;
  }

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

  test("scans once for a whole mutation batch", () => {
    blockSiteAds(doc, { Observer: FakeObserver as unknown as typeof MutationObserver });
    const observer = FakeObserver.last;
    if (observer === null) {
      throw new Error("expected the ad observer");
    }

    let queries = 0;
    const original = doc.querySelectorAll.bind(doc);
    Object.defineProperty(doc, "querySelectorAll", {
      configurable: true,
      value: (selector: string) => {
        queries += 1;
        return original(selector);
      },
    });

    const wrapperA = doc.createElement("div");
    const frameA = doc.createElement("iframe");
    frameA.src = "https://adserver.juicyads.com/adshow.php?adzone=4";
    wrapperA.append(frameA);

    const wrapperB = doc.createElement("div");
    const frameB = doc.createElement("iframe");
    frameB.src = "https://adserver.juicyads.com/adshow.php?adzone=5";
    wrapperB.append(frameB);
    doc.body.append(wrapperA, wrapperB);

    observer.trigger([added(wrapperA), added(wrapperB)]);

    expect(queries).toBe(1);
    expect(wrapperA.contains(frameA)).toBe(false);
    expect(wrapperB.contains(frameB)).toBe(false);
  });

  test("only checks src changes on elements that can load a site ad", () => {
    blockSiteAds(doc, { Observer: FakeObserver as unknown as typeof MutationObserver });
    const observer = FakeObserver.last;
    if (observer === null) {
      throw new Error("expected the ad observer");
    }

    let checked = 0;
    const div = doc.createElement("div");
    Object.defineProperty(div, "matches", {
      configurable: true,
      value: () => {
        checked += 1;
        return false;
      },
    });
    doc.body.append(div);

    observer.trigger([srcChanged(div)]);
    expect(checked).toBe(0);

    const ad = adScript(doc);
    doc.body.append(ad);
    observer.trigger([srcChanged(ad)]);
    expect(doc.body.contains(ad)).toBe(false);
  });

  test("strips an added subtree that was detached before the callback ran", () => {
    blockSiteAds(doc, { Observer: FakeObserver as unknown as typeof MutationObserver });
    const observer = FakeObserver.last;
    if (observer === null) {
      throw new Error("expected the ad observer");
    }

    const wrapper = doc.createElement("div");
    const frame = doc.createElement("iframe");
    frame.src = "https://adserver.juicyads.com/adshow.php?adzone=6";
    wrapper.append(frame);

    observer.trigger([added(wrapper)]);

    expect(wrapper.contains(frame)).toBe(false);
  });

  test("disconnects the observer when disposed", () => {
    const dispose = blockSiteAds(doc, {
      Observer: FakeObserver as unknown as typeof MutationObserver,
    });
    const observer = FakeObserver.last;
    if (observer === null) {
      throw new Error("expected the ad observer");
    }

    dispose();
    expect(observer.disconnected).toBe(true);
  });
});
