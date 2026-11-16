import { describe, expect, test } from "bun:test";

import { parseTitle } from "../../src/parse/title";

describe("parseTitle", () => {
  test("splits primary and secondary titles and collapses separator whitespace", () => {
    const title = parseTitle("Main Title | Side Story");
    expect(title.primary).toBe("Main Title");
    expect(title.secondary).toBe("Side Story");
    expect(title.leading).toEqual([]);
    expect(title.trailing).toEqual([]);

    const padded = parseTitle("  Main   Title   |   Side   Story  ");
    expect(padded.primary).toBe("Main   Title");
    expect(padded.secondary).toBe("Side   Story");
  });

  test("classifies leading artist, event, anthology and generic tags", () => {
    const title = parseTitle("(Comiket 100) [Circle] [Anthology] [Digital] A Title");
    expect(title.leading).toEqual([
      { text: "(Comiket 100)", type: "event" },
      { text: "[Circle]", type: "artist" },
      { text: "[Anthology]", type: "anthology" },
      { text: "[Digital]", type: "tag" },
    ]);
    expect(title.primary).toBe("A Title");
  });

  test("classifies trailing parody and language metadata", () => {
    const title = parseTitle("[Circle] A Title (Touhou Project) [English]");
    expect(title.leading).toEqual([{ text: "[Circle]", type: "artist" }]);
    expect(title.trailing).toEqual([
      { text: "(Touhou Project)", type: "parody" },
      { text: "[English]", type: "lang" },
    ]);
    expect(title.primary).toBe("A Title");
    expect(title.secondary).toBeNull();
  });

  test("treats unrecognized trailing brackets as generic tags", () => {
    const title = parseTitle("A Title [Uncensored]");
    expect(title.trailing).toEqual([{ text: "[Uncensored]", type: "tag" }]);
    expect(title.primary).toBe("A Title");
  });

  test("blank input becomes Untitled", () => {
    expect(parseTitle("   ")).toEqual({
      leading: [],
      primary: "Untitled",
      secondary: null,
      trailing: [],
    });
  });
});
