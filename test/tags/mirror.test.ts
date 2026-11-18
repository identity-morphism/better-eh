import { afterEach, describe, expect, test } from "bun:test";

import { assetUrls, fetchAsset } from "../../src/tags/mirror";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Replace the network with a table of responses keyed by host. */
function stubFetch(handler: (url: string) => Response): string[] {
  const calls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  return calls;
}

const CAP = 2 * 1024 * 1024;

describe("asset download", () => {
  test("skips a mirror that declares more bytes than an asset can hold", async () => {
    const oversized = new Uint8Array(CAP + 1);
    const calls = stubFetch((url) =>
      url.includes("raw.githubusercontent.com")
        ? new Response(oversized, { headers: { "content-length": String(oversized.byteLength) } })
        : new Response(new Uint8Array([1, 2, 3])),
    );

    const { value } = await fetchAsset(assetUrls("tag-index.bin"), (bytes) => bytes.byteLength, {
      label: "Tag index",
    });

    expect(value).toBe(3);
    expect(calls).toHaveLength(2);
  });

  test("stops reading a body that grows past the cap without declaring a length", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const calls = stubFetch((url) => {
      if (!url.includes("raw.githubusercontent.com")) {
        return new Response(new Uint8Array([7]));
      }
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          // Four megabytes of a chunked body: no content-length to check up front.
          for (let sent = 0; sent < 4; sent += 1) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });
      return new Response(body);
    });

    const { value } = await fetchAsset(assetUrls("tag-counts.bin"), (bytes) => bytes.byteLength, {
      label: "Tag counts",
    });

    expect(value).toBe(1);
    expect(calls).toHaveLength(2);
  });
});
