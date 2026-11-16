import type { ParsedTitle, TitleMetadata } from "../types";

const LANGUAGE =
  /\[(English|Japanese|Chinese|Korean|Thai|Vietnamese|French|German|Italian|Portuguese|Russian|Spanish)/i;
const NON_ARTIST_TAGS: Record<string, true> = {
  digital: true,
  colorized: true,
  decensored: true,
  incomplete: true,
  raw: true,
  translated: true,
  edited: true,
  webtoon: true,
  doujinshi: true,
  manga: true,
};

export function parseTitle(raw: string): ParsedTitle {
  let text = raw.trim();
  const leading: TitleMetadata[] = [];
  const trailing: TitleMetadata[] = [];

  for (;;) {
    const match = text.match(/^(\([^)]+\)|\[[^\]]+\])\s*/);
    const m = match?.[1];
    if (!m) {
      break;
    }

    let type: TitleMetadata["type"] = "tag";
    if (m.startsWith("(")) {
      type = "event";
    } else if (m.toLowerCase().includes("anthology")) {
      type = "anthology";
    } else {
      const inner = m.slice(1, -1).toLowerCase();
      if (NON_ARTIST_TAGS[inner] !== true) {
        type = "artist";
      }
    }

    leading.push({ text: m, type });
    text = text.slice(match[0].length).trim();
  }

  for (;;) {
    const match = text.match(/\s*(\([^)]+\)|\[[^\]]+\])$/);
    const m = match?.[1];
    if (!m) {
      break;
    }

    let type: TitleMetadata["type"] = "tag";
    if (m.startsWith("(")) {
      type = "parody";
    } else if (LANGUAGE.test(m)) {
      type = "lang";
    }

    trailing.unshift({ text: m, type });
    text = text.slice(0, -match[0].length).trim();
  }

  const parts = text.split(/\s*\|\s*/);

  return {
    leading,
    primary: parts[0] || "Untitled",
    secondary: parts[1] || null,
    trailing,
  };
}
