/**
 * Convert Airtable markdown (from richText fields) into TipTap JSON.
 * Uses `marked.lexer()` for parsing — no DOM required, safe for server-side.
 */

import { marked, type Token, type Tokens } from 'marked';

// =============================================================================
// TipTap JSON types (minimal subset used for generation)
// =============================================================================

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
  text?: string;
}

// =============================================================================
// Public API
// =============================================================================

/** Convert a markdown string to a serialized TipTap JSON document */
export function markdownToTiptapJson(markdown: string): string {
  if (!markdown) return JSON.stringify({ type: 'doc', content: [] });

  const tokens = marked.lexer(normalizeLooseEmphasis(markdown));
  const content = tokens.flatMap(tokenToNodes).filter(Boolean) as TiptapNode[];

  return JSON.stringify({ type: 'doc', content });
}

/**
 * Airtable serializes rich-text fields as "loose" markdown where emphasis
 * delimiters can sit directly against whitespace. For example, an italic
 * phrase split across a line becomes `_In person & online. _` — note the space
 * before the closing `_`. CommonMark (and therefore `marked`) requires the
 * closing delimiter to be right-flanking (no preceding whitespace) and the
 * opening delimiter to be left-flanking (no following whitespace), so these
 * spans are left as LITERAL underscores/asterisks instead of becoming
 * italic/bold — the source of the "underscores show on the published site" bug.
 *
 * This relocates whitespace sitting immediately inside a *balanced* emphasis
 * span to the outside of the delimiters (`_text _` → `_text_ `, `_ text_` →
 * ` _text_`), preserving the visible spacing while letting the parser recognize
 * the emphasis. The `\1` backreference requires a matching closing run, so
 * unpaired delimiters (e.g. "5 * 3" multiplication or a lone "_") are never
 * touched, and the content is prevented from crossing a blank line so emphasis
 * can't be mis-paired across paragraphs.
 */
function normalizeLooseEmphasis(markdown: string): string {
  return markdown.replace(
    /(\*{1,3}|_{1,3})([ \t]*)((?:(?!\n[ \t]*\n)[^])*?)([ \t]*)\1/g,
    (match, delim: string, lead: string, content: string, trail: string) => {
      if (content.trim() === '') return match; // delimiter-only run, leave as-is
      return `${lead}${delim}${content}${delim}${trail}`;
    },
  );
}

// =============================================================================
// Block-level token → TipTap node
// =============================================================================

function tokenToNodes(token: Token): TiptapNode[] {
  switch (token.type) {
    case 'paragraph':
      return [{ type: 'paragraph', content: inlineTokensToNodes(token.tokens ?? []) }];

    case 'heading':
      return [{
        type: 'heading',
        attrs: { level: token.depth },
        content: inlineTokensToNodes(token.tokens ?? []),
      }];

    case 'blockquote':
      return [{
        type: 'blockquote',
        content: (token.tokens ?? []).flatMap(tokenToNodes),
      }];

    case 'list':
      return [{
        type: token.ordered ? 'orderedList' : 'bulletList',
        ...(token.ordered && token.start !== 1 ? { attrs: { start: token.start } } : {}),
        content: token.items.map(listItemToNode),
      }];

    case 'code':
      return [{
        type: 'codeBlock',
        ...(token.lang ? { attrs: { language: token.lang } } : {}),
        content: [{ type: 'text', text: token.text }],
      }];

    case 'hr':
      return [{ type: 'horizontalRule' }];

    case 'space':
      return [];

    default:
      if ('text' in token && typeof token.text === 'string' && token.text.trim()) {
        return [{ type: 'paragraph', content: [{ type: 'text', text: token.text }] }];
      }
      return [];
  }
}

function listItemToNode(item: Tokens.ListItem): TiptapNode {
  const children: TiptapNode[] = [];

  for (const child of item.tokens ?? []) {
    if (child.type === 'text') {
      children.push({
        type: 'paragraph',
        content: inlineTokensToNodes(
          (child as Tokens.Text).tokens ?? [{ type: 'text', raw: child.raw, text: child.text } as Tokens.Text]
        ),
      });
    } else if (child.type === 'list') {
      children.push(...tokenToNodes(child));
    } else {
      children.push(...tokenToNodes(child));
    }
  }

  return { type: 'listItem', content: children };
}

// =============================================================================
// Inline tokens → TipTap text nodes with marks
// =============================================================================

function inlineTokensToNodes(tokens: Token[]): TiptapNode[] {
  const nodes: TiptapNode[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        if (token.text) nodes.push({ type: 'text', text: token.text });
        break;

      case 'strong':
        nodes.push(...wrapWithMark(token.tokens ?? [], { type: 'bold' }));
        break;

      case 'em':
        nodes.push(...wrapWithMark(token.tokens ?? [], { type: 'italic' }));
        break;

      case 'del':
        nodes.push(...wrapWithMark(token.tokens ?? [], { type: 'strike' }));
        break;

      case 'codespan':
        nodes.push({
          type: 'text',
          text: token.text,
          marks: [{ type: 'code' }],
        });
        break;

      case 'link':
        nodes.push(...wrapWithMark(
          token.tokens ?? [],
          {
            type: 'richTextLink',
            attrs: {
              type: 'url',
              url: { type: 'dynamic_text', data: { content: token.href } },
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
            },
          }
        ));
        break;

      case 'image':
        nodes.push({
          type: 'richTextImage',
          attrs: { src: token.href, alt: token.text || null, title: token.title || null },
        });
        break;

      case 'br':
        nodes.push({ type: 'hardBreak' });
        break;

      case 'escape':
        nodes.push({ type: 'text', text: token.text });
        break;

      default:
        if ('text' in token && typeof token.text === 'string' && token.text) {
          nodes.push({ type: 'text', text: token.text });
        }
        break;
    }
  }

  return nodes;
}

/** Recursively process child tokens and add a mark to every resulting text node */
function wrapWithMark(tokens: Token[], mark: TiptapMark): TiptapNode[] {
  const inner = inlineTokensToNodes(tokens);
  return inner.map((node) => {
    if (node.type === 'text') {
      return { ...node, marks: [...(node.marks ?? []), mark] };
    }
    return node;
  });
}
