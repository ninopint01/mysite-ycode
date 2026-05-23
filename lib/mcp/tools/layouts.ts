import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Layer } from '@/types';
import { getDraftLayers, upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import {
  getLayoutTemplate,
  getLayoutCategory,
  getLayoutPreviewImage,
  getLayoutsByCategory,
} from '@/lib/templates/blocks';
import { findLayerById, insertLayer, canHaveChildren } from '@/lib/mcp/utils';
import { broadcastLayersChanged } from '@/lib/mcp/broadcast';

interface CatalogEntry {
  key: string;
  preview_image_url?: string;
}

/**
 * Auto-derive the layout catalog from `layoutTemplates` so it can never
 * drift from the source of truth (previously caused `blog-header-*` and
 * `blog-001..006` keys to be advertised but unusable).
 */
function buildLayoutCatalog(): Record<string, CatalogEntry[]> {
  const byCategory = getLayoutsByCategory();
  const result: Record<string, CatalogEntry[]> = {};

  for (const [category, keys] of Object.entries(byCategory)) {
    result[category] = keys.map((key) => {
      const preview = getLayoutPreviewImage(key);
      return preview ? { key, preview_image_url: preview } : { key };
    });
  }

  return result;
}

export function registerLayoutTools(server: McpServer) {
  server.tool(
    'list_layouts',
    `List all available pre-built layout templates organized by category.
Use add_layout to insert any of these into a page.`,
    {},
    async () => {
      const catalog = buildLayoutCatalog();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(catalog, null, 2) }],
      };
    },
  );

  server.tool(
    'add_layout',
    `Insert a pre-built layout section into a page from YCode's template library.
Use list_layouts to see available layouts.`,
    {
      page_id: z.string().describe('The page ID'),
      layout_key: z.string().describe('Layout key from list_layouts (e.g. "hero-001")'),
      parent_layer_id: z.string().optional().describe('Parent layer ID. If omitted, appends to page root.'),
      position: z.number().optional().describe('Position within parent. Omit to append at end.'),
    },
    async ({ page_id, layout_key, parent_layer_id, position }) => {
      const layoutLayer = getLayoutTemplate(layout_key);
      if (!layoutLayer) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: Unknown layout "${layout_key}". Use list_layouts to see available layouts.`,
          }],
          isError: true,
        };
      }

      const category = getLayoutCategory(layout_key);

      const pageLayers = await getDraftLayers(page_id);
      let layers = (pageLayers?.layers as Layer[]) || [];

      if (parent_layer_id) {
        const parent = findLayerById(layers, parent_layer_id);
        if (!parent) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: Parent "${parent_layer_id}" not found.`,
            }],
            isError: true,
          };
        }
        if (!canHaveChildren(parent)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: "${parent.customName || parent.name}" cannot have children.`,
            }],
            isError: true,
          };
        }
        layers = insertLayer(layers, parent_layer_id, layoutLayer, position);
      } else if (position !== undefined) {
        layers = [...layers];
        layers.splice(position, 0, layoutLayer);
      } else {
        layers = [...layers, layoutLayer];
      }

      await upsertDraftLayers(page_id, layers);
      broadcastLayersChanged(page_id, layers).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Added ${category || 'layout'} section to page`,
            section_id: layoutLayer.id,
            container_id: layoutLayer.children?.[0]?.id,
            layout_key,
            category,
          }, null, 2),
        }],
      };
    },
  );
}
