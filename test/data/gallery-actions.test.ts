import { describe, expect, test } from "bun:test";

import { rateGallery, voteComment, voteTag } from "../../src/data/gallery-actions";
import type { GalleryApiConfig } from "../../src/types";

const CONFIG: GalleryApiConfig = {
  apiUrl: "https://api.example/api.php",
  apiUid: "42",
  apiKey: "secret",
  gid: "123456",
  token: "abcdef1234",
};

describe("gallery action API calls", () => {
  test("rates on the half-star scale and maps the response", async () => {
    const bodies: unknown[] = [];
    const result = await rateGallery(CONFIG, 3, {
      post: (url, body) => {
        expect(url).toBe(CONFIG.apiUrl);
        bodies.push(body);
        return Promise.resolve({
          rating_avg: 4.61,
          rating_usr: 3,
          rating_cls: "ir",
          rating_cnt: 150,
        });
      },
    });

    expect(bodies).toEqual([
      {
        apiuid: "42",
        apikey: "secret",
        gid: "123456",
        token: "abcdef1234",
        method: "rategallery",
        rating: 6,
      },
    ]);
    expect(result).toEqual({ average: 4.61, votes: 150, user: 3 });
  });

  test("votes tags and surfaces API errors", async () => {
    const bodies: unknown[] = [];
    await voteTag(CONFIG, "artist:alice", -1, {
      post: (_url, body) => {
        bodies.push(body);
        return Promise.resolve({});
      },
    });

    expect(bodies[0]).toEqual({
      apiuid: "42",
      apikey: "secret",
      gid: "123456",
      token: "abcdef1234",
      method: "taggallery",
      tags: "artist:alice",
      vote: -1,
    });

    await expect(
      voteTag(CONFIG, "artist:alice", 1, {
        post: () => Promise.resolve({ error: "Vote limit reached" }),
      }),
    ).rejects.toThrow("Could not vote for tag: Vote limit reached");
  });

  test("returns the updated comment score and rejects a malformed reply", async () => {
    const result = await voteComment(CONFIG, 9001, 1, {
      post: () => Promise.resolve({ comment_id: 9001, comment_score: 8, comment_vote: 1 }),
    });
    expect(result).toEqual({ id: 9001, score: 8, vote: 1 });

    await expect(
      voteComment(CONFIG, 9001, 1, { post: () => Promise.resolve({ comment_id: 9001 }) }),
    ).rejects.toThrow("malformed response");
  });
});
