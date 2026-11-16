import type { ListItem } from "../../src/types";

/** The base result card shared by the list and preview tests. */
export function listItem(overrides: Partial<ListItem> = {}): ListItem {
  return {
    href: "/g/111/aaaa/",
    gid: "111",
    token: "aaaa",
    title: {
      leading: [{ text: "[Circle]", type: "artist" }],
      primary: "Alpha",
      secondary: "Extra",
      trailing: [],
    },
    coverSrc: "https://img.example/111.jpg",
    coverSize: { width: 250, height: 353 },
    rating: 4,
    category: { name: "Doujinshi", cls: "ct2" },
    uploader: "alice74",
    uploaderHref: null,
    posted: "2024-01-01 12:00",
    pages: 10,
    torrentsHref: "https://e-hentai.org/gallerytorrents.php?gid=111&t=aaaa",
    favorite: null,
    ...overrides,
  };
}
