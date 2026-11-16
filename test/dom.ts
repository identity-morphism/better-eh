import { parseHTML } from "linkedom";

/** Dev-only DOM adapter: Bun has no DOM, so fixtures are parsed through linkedom. */
export function parseDocument(html: string): Document {
  return parseHTML(html).document;
}

export async function loadFixture(name: string): Promise<Document> {
  const html = await Bun.file(`${import.meta.dir}/fixtures/${name}`).text();
  return parseDocument(html);
}
