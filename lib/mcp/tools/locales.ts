import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getAllLocales,
  createLocale,
  updateLocale,
  deleteLocale,
  setDefaultLocale,
} from '@/lib/repositories/localeRepository';
import {
  getTranslationsByLocale,
  createTranslation,
  updateTranslation,
  deleteTranslation,
  upsertTranslations,
} from '@/lib/repositories/translationRepository';
import { buildTiptapDoc } from '@/lib/mcp/utils';
import type { RichTextBlock } from '@/lib/mcp/utils';

const richTextBlockSchema = z.object({
  type: z.enum(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule']),
  text: z.string().optional().describe('Text content. Supports **bold**, *italic*, [link](url).'),
  level: z.number().optional().describe('Heading level 1-6 (for heading type)'),
  items: z.array(z.string()).optional().describe('List items (for bulletList/orderedList)'),
});

export function registerLocaleTools(server: McpServer) {
  server.tool(
    'list_locales',
    'List all locales (languages) configured for the site. The default locale is the primary language.',
    {},
    async () => {
      const locales = await getAllLocales(false);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(locales.map((l) => ({
            id: l.id,
            code: l.code,
            label: l.label,
            is_default: l.is_default,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'create_locale',
    'Add a new locale (language) to the site. Use ISO 639-1 codes (e.g. "en", "fr", "de", "es", "ja").',
    {
      code: z.string().describe('ISO 639-1 language code (e.g. "fr", "de", "ja")'),
      label: z.string().describe('Human-readable label (e.g. "French", "German", "Japanese")'),
      is_default: z.boolean().optional().describe('Set as the default locale. Only one locale can be default.'),
    },
    async ({ code, label, is_default }) => {
      const { locale } = await createLocale({ code, label, is_default });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Created locale "${label}" (${code})`, locale }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_locale',
    'Update a locale label or set it as default.',
    {
      locale_id: z.string().describe('The locale ID'),
      label: z.string().optional().describe('New label'),
      is_default: z.boolean().optional().describe('Set as default locale'),
    },
    async ({ locale_id, label, is_default }) => {
      const updates: Record<string, unknown> = {};
      if (label !== undefined) updates.label = label;
      if (is_default !== undefined) updates.is_default = is_default;

      const { locale } = await updateLocale(locale_id, updates);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Updated locale "${locale.label}"`, locale }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'delete_locale',
    'Delete a locale. Cannot delete the default locale — set another locale as default first.',
    {
      locale_id: z.string().describe('The locale ID to delete'),
    },
    async ({ locale_id }) => {
      await deleteLocale(locale_id);
      return {
        content: [{ type: 'text' as const, text: `Locale ${locale_id} deleted successfully.` }],
      };
    },
  );

  server.tool(
    'set_default_locale',
    'Set a locale as the default (primary) language for the site.',
    {
      locale_id: z.string().describe('The locale ID to set as default'),
    },
    async ({ locale_id }) => {
      const locale = await setDefaultLocale(locale_id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Set "${locale.label}" as default locale`, locale }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_translations',
    'List all translations for a specific locale.',
    {
      locale_id: z.string().describe('The locale ID to get translations for'),
    },
    async ({ locale_id }) => {
      const translations = await getTranslationsByLocale(locale_id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(translations.map((t) => ({
            id: t.id,
            source_type: t.source_type,
            source_id: t.source_id,
            content_key: t.content_key,
            content_type: t.content_type,
            content_value: t.content_value,
            is_completed: t.is_completed,
          })), null, 2),
        }],
      };
    },
  );

  server.tool(
    'set_translation',
    'Create or update a translation for a specific content key in a locale.',
    {
      locale_id: z.string().describe('The locale ID'),
      source_type: z.enum(['page', 'folder', 'component', 'cms']).describe('Type of source being translated'),
      source_id: z.string().describe('ID of the source (page ID, component ID, etc.)'),
      content_key: z.string().describe('Content key identifying what is being translated (e.g. layer ID or field name)'),
      content_type: z.enum(['text', 'richtext', 'asset_id']).optional().describe('Type of content. Defaults to "text".'),
      content_value: z.string().describe('The translated content'),
      is_completed: z.boolean().optional().describe('Mark translation as complete. Defaults to false.'),
    },
    async ({ locale_id, source_type, source_id, content_key, content_type, content_value, is_completed }) => {
      const translation = await createTranslation({
        locale_id,
        source_type,
        source_id,
        content_key,
        content_type: content_type || 'text',
        content_value,
        is_completed,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Translation saved', translation }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'batch_set_translations',
    'Create or update multiple translations at once. Efficient for translating many content keys.',
    {
      translations: z.array(z.object({
        locale_id: z.string(),
        source_type: z.enum(['page', 'folder', 'component', 'cms']),
        source_id: z.string(),
        content_key: z.string(),
        content_type: z.enum(['text', 'richtext', 'asset_id']).optional(),
        content_value: z.string(),
        is_completed: z.boolean().optional(),
      })).min(1).max(100).describe('Array of translations to upsert (max 100)'),
    },
    async ({ translations }) => {
      const data = translations.map((t) => ({
        locale_id: t.locale_id,
        source_type: t.source_type as 'page' | 'folder' | 'component' | 'cms',
        source_id: t.source_id,
        content_key: t.content_key,
        content_type: (t.content_type || 'text') as 'text' | 'richtext' | 'asset_id',
        content_value: t.content_value,
        is_completed: t.is_completed,
      }));
      const result = await upsertTranslations(data);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: `Saved ${result.length} translations`, count: result.length }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_translation',
    'Update an existing translation value or completion status.',
    {
      translation_id: z.string().describe('The translation ID'),
      content_value: z.string().optional().describe('New translated content'),
      is_completed: z.boolean().optional().describe('Mark as complete or incomplete'),
    },
    async ({ translation_id, content_value, is_completed }) => {
      const updates: Record<string, unknown> = {};
      if (content_value !== undefined) updates.content_value = content_value;
      if (is_completed !== undefined) updates.is_completed = is_completed;

      const translation = await updateTranslation(translation_id, updates);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Translation updated', translation }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'delete_translation',
    'Delete a translation.',
    {
      translation_id: z.string().describe('The translation ID to delete'),
    },
    async ({ translation_id }) => {
      await deleteTranslation(translation_id);
      return {
        content: [{ type: 'text' as const, text: `Translation ${translation_id} deleted successfully.` }],
      };
    },
  );

  server.tool(
    'set_rich_text_translation',
    `Translate a rich-text content key by passing structured blocks. The blocks are converted
to the Tiptap JSON shape that Ycode expects for richtext translations and stored as
content_value. Equivalent to calling set_translation with content_type "richtext" but the
agent doesn't have to assemble the JSON by hand.

Block types match add_layer's rich_content: paragraph, heading, blockquote, bulletList,
orderedList, codeBlock, horizontalRule. Text supports **bold**, *italic*, [link](url).`,
    {
      locale_id: z.string().describe('The locale ID'),
      source_type: z.enum(['page', 'folder', 'component', 'cms']).describe('Type of source being translated'),
      source_id: z.string().describe('ID of the source (page ID, component ID, etc.)'),
      content_key: z.string().describe('Content key identifying the rich-text field (e.g. layer ID or "richtext:<field id>")'),
      blocks: z.array(richTextBlockSchema).min(1).describe('Rich-text blocks describing the translated content'),
      is_completed: z.boolean().optional().describe('Mark translation as complete. Defaults to false.'),
    },
    async ({ locale_id, source_type, source_id, content_key, blocks, is_completed }) => {
      const doc = buildTiptapDoc(blocks as RichTextBlock[]);
      const translation = await createTranslation({
        locale_id,
        source_type,
        source_id,
        content_key,
        content_type: 'richtext',
        content_value: JSON.stringify(doc),
        is_completed,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ message: 'Rich-text translation saved', translation }, null, 2),
        }],
      };
    },
  );
}
