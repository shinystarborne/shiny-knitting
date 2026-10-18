/**
 * Web and mail addresses written in a page's text but not made links in the
 * PDF -- www.shop.com, ravelry.com/designers/…, me@mail.com -- found so the
 * reader can make them clickable, as a PDF reader does.
 *
 * Read on the text as search reads it (annotations.ts textIndex): lower-cased,
 * whitespace collapsed, a boundary between two runs of text a space.
 */

/** The endings a bare name is taken as an address by: shops and countries knitters meet. */
const ENDINGS = "com|net|org|info|shop|store|online|eu|uk|de|at|ch|fr|it|es|pt|nl|be|dk|se|no|fi|is|ee|lv|lt|pl|cz|sk|hu|si|hr|ie|ca|us|au|nz|jp|io|co";
const CHARS = String.raw`[^\s<>"'{}|\\^\`]`;
const ADDRESS = new RegExp(
  [
    String.raw`(?:https?://|www\.)${CHARS}+`,
    String.raw`[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}`,
    String.raw`\b(?:[a-z0-9-]+\.)+(?:${ENDINGS})(?:/${CHARS}*)?(?![a-z0-9@-])`,
  ].join("|"),
  "g",
);
/** An address broken over a line ends in one of these, and goes on in the next run. */
const BROKEN = /[/\-_=?&#%]$/;
const GOES_ON = new RegExp(String.raw`^${CHARS}+`);

/** Where each address is in the text: its start and end. */
export function findAddresses(text: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  for (const m of text.matchAll(ADDRESS)) {
    const start = m.index!;
    let end = start + m[0].length;
    if (found.length && start < found[found.length - 1].end) continue;
    // Broken over a line: …/patterns/ then the rest on the next.
    while (!m[0].includes("@") && BROKEN.test(text.slice(start, end)) && text[end] === " ") {
      const rest = GOES_ON.exec(text.slice(end + 1));
      if (!rest || /^(https?:|www\.)/.test(rest[0])) break;
      end += 1 + rest[0].length;
    }
    // What ends a sentence is not the address's: "see www.shop.com." or "(www.shop.com)".
    let word = text.slice(start, end);
    for (;;) {
      const last = word[word.length - 1];
      const unopened = last === ")" && (word.match(/\(/g)?.length ?? 0) < (word.match(/\)/g)?.length ?? 0);
      if (!/[.,;:!?'"»\]]/.test(last) && !unopened) break;
      word = word.slice(0, -1);
    }
    end = start + word.length;
    if (word.length > 4) found.push({ start, end });
  }
  return found;
}

/** The address to open for one written on the page, or null when it is none. */
export function addressUrl(written: string): string | null {
  const w = written.replace(/\s+/g, "");
  if (!w) return null;
  if (/^https?:\/\//i.test(w)) return w;
  if (w.includes("@") && !w.includes("/")) return `mailto:${w}`;
  return `https://${w}`;
}
