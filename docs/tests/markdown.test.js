/* The Markdown subset, and the documents that actually ship. Parsing is a
 * pure function of text, so both can be checked without a browser. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse, parseInline, plain, title } from "../ui/markdown.js";
import { TOPICS, pathFor } from "../help.js";

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---- inline ---------------------------------------------------------- */

test("bold beats italic at the same position", () => {
  assert.deepEqual(parseInline("**loud**").map((s) => s.type), ["strong"]);
  assert.deepEqual(parseInline("*soft*").map((s) => s.type), ["em"]);
  assert.equal(plain(parseInline("**loud**")), "loud");
});

test("links carry their href, and may hold emphasis", () => {
  // Exactly the shape the shipped sources use.
  const spans = parseInline("([Bouterse, *Making Woodwind Instruments*](https://x.test/a.pdf))");
  const link = spans.find((s) => s.type === "link");
  assert.equal(link.href, "https://x.test/a.pdf");
  assert.ok(link.spans.some((s) => s.type === "em"));
  assert.equal(plain(link.spans), "Bouterse, Making Woodwind Instruments");
  assert.equal(plain(spans), "(Bouterse, Making Woodwind Instruments)");
});

test("code is literal and text with no markers passes through", () => {
  assert.deepEqual(parseInline("`a*b*c`"), [{ type: "code", text: "a*b*c" }]);
  assert.deepEqual(parseInline("plain"), [{ type: "text", text: "plain" }]);
});

/* ---- blocks ---------------------------------------------------------- */

test("soft-wrapped paragraph lines are joined, so spans may cross them", () => {
  const blocks = parse("The result: **the lowest octave\nbarely moved** — with\nthe rest.");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(plain(blocks[0].spans), "The result: the lowest octave barely moved — with the rest.");
  assert.ok(blocks[0].spans.some((s) => s.type === "strong"), "bold survives the line break");
});

test("headings, rules, quotes and both kinds of list", () => {
  const blocks = parse([
    "# Title", "", "## Section", "", "text", "", "---", "",
    "- one", "  wrapped", "- two", "", "1. first", "2. second", "", "> quoted",
  ].join("\n"));
  assert.deepEqual(blocks.map((b) => b.type),
    ["heading", "heading", "paragraph", "rule", "list", "list", "quote"]);
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[1].level, 2);
  const bullets = blocks[4];
  assert.equal(bullets.ordered, false);
  assert.equal(bullets.items.length, 2);
  assert.equal(plain(bullets.items[0]), "one wrapped", "a wrapped item stays one item");
  assert.equal(blocks[5].ordered, true);
  assert.equal(plain(blocks[6].spans), "quoted");
});

test("a paragraph starting with emphasis is not mistaken for a list", () => {
  const blocks = parse("*Versuch* is a treatise.");
  assert.equal(blocks[0].type, "paragraph");
  assert.equal(plain(blocks[0].spans), "Versuch is a treatise.");
});

test("title() is the document's own first heading", () => {
  assert.equal(title("# Hello *there*\n\nbody"), "Hello there");
  assert.equal(title("no heading here"), null);
});

/* ---- the shipped documents ------------------------------------------- */

test("every registered topic file exists, in every language it claims", () => {
  for (const [topic, byLanguage] of Object.entries(TOPICS)) {
    for (const [language, file] of Object.entries(byLanguage)) {
      assert.ok(fs.existsSync(path.join(docs, file)), `${topic}.${language}: ${file}`);
      assert.equal(pathFor(topic, language), file);
    }
    assert.ok(byLanguage.en && byLanguage.fr, `${topic} ships in both languages`);
    // An unknown language falls back rather than failing.
    assert.equal(pathFor(topic, "de"), byLanguage.en);
  }
  assert.equal(pathFor("nope", "en"), null);
});

test("the shipped documents parse into real content with working links", () => {
  for (const byLanguage of Object.values(TOPICS)) {
    for (const [language, file] of Object.entries(byLanguage)) {
      const text = fs.readFileSync(path.join(docs, file), "utf8");
      const blocks = parse(text);

      assert.equal(blocks[0].type, "heading", `${file} opens with its title`);
      assert.equal(blocks[0].level, 1);
      assert.ok(title(text).length > 10, `${file} has a real title`);
      assert.ok(blocks.filter((b) => b.type === "heading").length >= 5, `${file} has sections`);
      assert.ok(blocks.some((b) => b.type === "list"), `${file} has its source list`);

      // Every link must have an absolute href: a relative one would break
      // once the document is downloaded and read outside the app.
      const links = [];
      const walk = (spans) => spans.forEach((s) => {
        if (s.type === "link") links.push(s);
        if (s.spans) walk(s.spans);
      });
      for (const block of blocks) {
        if (block.spans) walk(block.spans);
        if (block.items) block.items.forEach(walk);
      }
      assert.ok(links.length >= 5, `${file} cites sources`);
      for (const link of links) {
        assert.match(link.href, /^https:\/\//, `${file}: ${link.href}`);
        assert.ok(plain(link.spans).trim().length > 0, `${file}: link has text`);
      }
      // No stray markers left unparsed in the visible text.
      const visible = blocks.filter((b) => b.spans).map((b) => plain(b.spans)).join(" ");
      assert.ok(!visible.includes("**"), `${file} has no unclosed bold`);
      assert.ok(!/\]\(/.test(visible), `${file} has no unparsed link`);
      void language;
    }
  }
});
