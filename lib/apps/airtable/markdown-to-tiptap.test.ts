import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToTiptapJson } from '@/lib/apps/airtable/markdown-to-tiptap';

interface Node {
  type: string;
  text?: string;
  marks?: { type: string }[];
  content?: Node[];
}

function parse(markdown: string): Node {
  return JSON.parse(markdownToTiptapJson(markdown)) as Node;
}

/** Flatten all text nodes in document order. */
function textNodes(doc: Node): Node[] {
  const out: Node[] = [];
  const walk = (node: Node) => {
    if (node.type === 'text') out.push(node);
    node.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

/** Concatenated plain text of the whole document. */
function plainText(doc: Node): string {
  return textNodes(doc).map((n) => n.text ?? '').join('');
}

function hasMark(node: Node, mark: string): boolean {
  return !!node.marks?.some((m) => m.type === mark);
}

// ---------------------------------------------------------------------------
// The Airtable "loose emphasis" bug: a space before the closing delimiter made
// marked treat the whole span as literal text (underscores rendered verbatim).
// ---------------------------------------------------------------------------

test('italic span with a trailing space before the closing _ becomes italic (not literal underscores)', () => {
  const doc = parse('_In person & online. _');
  const text = plainText(doc);
  assert.equal(text.includes('_'), false, 'no literal underscores should remain');
  const italic = textNodes(doc).find((n) => hasMark(n, 'italic'));
  assert.ok(italic, 'expected an italic text node');
  assert.equal(italic?.text, 'In person & online.');
});

test('multi-paragraph italic split across a line break converts both lines to italic', () => {
  const doc = parse('_In person & online. _\n\n_Open to members & non-members_');
  assert.equal(plainText(doc).includes('_'), false, 'no literal underscores');
  const italics = textNodes(doc).filter((n) => hasMark(n, 'italic')).map((n) => n.text);
  assert.deepEqual(italics, ['In person & online.', 'Open to members & non-members']);
});

test('leading space inside the opening delimiter is relocated and parsed as italic', () => {
  const doc = parse('_ leading space italic_');
  assert.equal(plainText(doc).includes('_'), false);
  const italic = textNodes(doc).find((n) => hasMark(n, 'italic'));
  assert.equal(italic?.text, 'leading space italic');
});

// ---------------------------------------------------------------------------
// Bold and well-formed emphasis must keep working.
// ---------------------------------------------------------------------------

test('bold via ** still converts to a bold mark', () => {
  const doc = parse('Liam: Please **join** use');
  const bold = textNodes(doc).find((n) => hasMark(n, 'bold'));
  assert.equal(bold?.text, 'join');
});

test('already-correct italic is unaffected', () => {
  const doc = parse('already _correct_ italic');
  const italic = textNodes(doc).find((n) => hasMark(n, 'italic'));
  assert.equal(italic?.text, 'correct');
  assert.equal(plainText(doc), 'already correct italic');
});

// ---------------------------------------------------------------------------
// Safety: unpaired / literal delimiters must NOT be mangled.
// ---------------------------------------------------------------------------

test('snake_case identifiers are left intact', () => {
  const doc = parse('snake_case_variable here');
  assert.equal(plainText(doc), 'snake_case_variable here');
});

test('a lone underscore with surrounding spaces stays literal', () => {
  const doc = parse('fill in the _ blank here');
  assert.equal(plainText(doc), 'fill in the _ blank here');
});

test('a lone asterisk (multiplication) stays literal', () => {
  const doc = parse('price is 5 * 3 = 15');
  assert.equal(plainText(doc), 'price is 5 * 3 = 15');
});
