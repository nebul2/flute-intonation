/* A small Markdown subset, parsed to a block tree and then to DOM.
 *
 * Two steps on purpose: `parse` is a pure function of text and can be tested
 * headlessly, and `render` turns its output into nodes. Nodes are built with
 * createElement and text nodes throughout -- never innerHTML -- so a document
 * can never inject markup, whoever wrote it.
 *
 * Supported: ATX headings, paragraphs (soft-wrapped lines joined), bullet and
 * numbered lists, blockquotes, horizontal rules, and inline code, links,
 * strong and emphasis, nested (the shipped documents put italics inside link
 * text). Not supported, because nothing ships with them: tables, images,
 * fenced code, reference links, raw HTML. */

const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;

/* Inline patterns, in priority order: when two match at the same position the
 * earlier one wins, which is what makes `**bold**` beat `*italic*`. */
const INLINE = [
  { re: /`([^`]+)`/, build: (m) => ({ type: "code", text: m[1] }) },
  { re: /\[([^\]]+)\]\(([^)\s]+)\)/, build: (m) => ({ type: "link", href: m[2], spans: parseInline(m[1]) }) },
  { re: /\*\*([\s\S]+?)\*\*/, build: (m) => ({ type: "strong", spans: parseInline(m[1]) }) },
  { re: /\*([^*]+?)\*/, build: (m) => ({ type: "em", spans: parseInline(m[1]) }) },
];

export function parseInline(text) {
  const spans = [];
  let rest = String(text);
  while (rest.length) {
    let best = null;
    for (const pattern of INLINE) {
      const match = pattern.re.exec(rest);
      if (match && (!best || match.index < best.match.index)) best = { pattern, match };
    }
    if (!best) { spans.push({ type: "text", text: rest }); break; }
    if (best.match.index > 0) spans.push({ type: "text", text: rest.slice(0, best.match.index) });
    spans.push(best.pattern.build(best.match));
    rest = rest.slice(best.match.index + best.match[0].length);
  }
  return spans;
}

export function parse(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;

  const isBlockStart = (line) =>
    HEADING.test(line) || RULE.test(line) || BULLET.test(line)
    || NUMBERED.test(line) || QUOTE.test(line);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, spans: parseInline(heading[2].trim()) });
      i += 1;
      continue;
    }
    if (RULE.test(line)) { blocks.push({ type: "rule" }); i += 1; continue; }

    if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = NUMBERED.test(line) && !BULLET.test(line);
      const marker = ordered ? NUMBERED : BULLET;
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        const item = marker.exec(lines[i]);
        if (item) items.push(item[1].trim());
        else if (items.length) items[items.length - 1] += ` ${lines[i].trim()}`;   // wrapped item
        else break;
        i += 1;
      }
      blocks.push({ type: "list", ordered, items: items.map(parseInline) });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(QUOTE.exec(lines[i])[1].trim());
        i += 1;
      }
      blocks.push({ type: "quote", spans: parseInline(quoted.join(" ")) });
      continue;
    }

    // A paragraph runs until a blank line or the start of another block; its
    // soft-wrapped lines are joined so inline spans may cross line breaks.
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paragraph.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", spans: parseInline(paragraph.join(" ")) });
  }
  return blocks;
}

/* ---- to DOM ---------------------------------------------------------- */

function renderSpans(spans, parent) {
  for (const span of spans) {
    if (span.type === "text") { parent.append(document.createTextNode(span.text)); continue; }
    if (span.type === "code") {
      const code = document.createElement("code");
      code.textContent = span.text;
      parent.append(code);
      continue;
    }
    const tag = span.type === "link" ? "a" : span.type === "strong" ? "strong" : "em";
    const node = document.createElement(tag);
    if (span.type === "link") {
      node.href = span.href;
      node.target = "_blank";
      node.rel = "noopener noreferrer";
    }
    renderSpans(span.spans, node);
    parent.append(node);
  }
}

function renderBlock(block) {
  if (block.type === "rule") return document.createElement("hr");
  if (block.type === "heading") {
    // Headings inside a document start at h3: the page already owns h1/h2.
    const node = document.createElement(`h${Math.min(6, block.level + 2)}`);
    renderSpans(block.spans, node);
    return node;
  }
  if (block.type === "list") {
    const list = document.createElement(block.ordered ? "ol" : "ul");
    for (const item of block.items) {
      const li = document.createElement("li");
      renderSpans(item, li);
      list.append(li);
    }
    return list;
  }
  const node = document.createElement(block.type === "quote" ? "blockquote" : "p");
  renderSpans(block.spans, node);
  return node;
}

export function render(text) {
  const fragment = document.createDocumentFragment();
  for (const block of parse(text)) fragment.append(renderBlock(block));
  return fragment;
}

/* The document's own first heading, for a title. */
export function title(text) {
  const first = parse(text).find((block) => block.type === "heading");
  return first ? plain(first.spans) : null;
}

export function plain(spans) {
  return spans.map((span) => (span.type === "text" || span.type === "code")
    ? span.text : plain(span.spans)).join("");
}
