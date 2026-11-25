import { describe, expect, test } from "bun:test";

import { parseTitle } from "../../src/parse/title";

describe("parseTitle", () => {
  test("splits primary and secondary titles and turns blank input into Untitled", () => {
    const title = parseTitle("Main Title | Side Story");
    expect(title.primary).toBe("Main Title");
    expect(title.secondary).toBe("Side Story");
    expect(title.leading).toEqual([]);
    expect(title.trailing).toEqual([]);

    const padded = parseTitle("  Main   Title   |   Side   Story  ");
    expect(padded.primary).toBe("Main   Title");
    expect(padded.secondary).toBe("Side   Story");

    expect(parseTitle("   ")).toEqual({
      leading: [],
      primary: "Untitled",
      secondary: null,
      trailing: [],
    });
  });

  test("classifies leading and trailing metadata brackets", () => {
    const leading = parseTitle("(Comiket 100) [Circle] [Anthology] [Digital] A Title");
    expect(leading.leading).toEqual([
      { text: "(Comiket 100)", type: "event" },
      { text: "[Circle]", type: "artist" },
      { text: "[Anthology]", type: "anthology" },
      { text: "[Digital]", type: "tag" },
    ]);
    expect(leading.primary).toBe("A Title");

    const trailing = parseTitle("[Circle] A Title (Touhou Project) [English]");
    expect(trailing.leading).toEqual([{ text: "[Circle]", type: "artist" }]);
    expect(trailing.trailing).toEqual([
      { text: "(Touhou Project)", type: "parody" },
      { text: "[English]", type: "lang" },
    ]);
    expect(trailing.primary).toBe("A Title");
    expect(trailing.secondary).toBeNull();

    const generic = parseTitle("A Title [Uncensored]");
    expect(generic.trailing).toEqual([{ text: "[Uncensored]", type: "tag" }]);
    expect(generic.primary).toBe("A Title");
  });
});
