import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DesignProperties, Layer, LinkSettings } from '@/types';
import { getDraftLayers, upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import {
  findLayerById,
  updateLayerById,
  insertLayer,
  removeLayer,
  moveLayer as moveLayerInTree,
  canHaveChildren,
  createLayerFromTemplate,
  getTiptapTextContent,
  buildTiptapDoc,
  applyDesignToLayer,
} from '@/lib/mcp/utils';
import type { RichTextBlock } from '@/lib/mcp/utils';
import { layerToExportHtml } from '@/lib/html-layer-converter';
import { broadcastLayersChanged } from '@/lib/mcp/broadcast';
import { designSchema, richTextBlockSchema, templateEnum } from './shared-schemas';

async function getPageLayers(pageId: string): Promise<Layer[]> {
  const pageLayers = await getDraftLayers(pageId);
  return (pageLayers?.layers as Layer[]) || [];
}

async function savePageLayers(pageId: string, layers: Layer[]): Promise<void> {
  await upsertDraftLayers(pageId, layers);
  broadcastLayersChanged(pageId, layers).catch(() => {});
}

export function registerLayerTools(server: McpServer) {
  server.tool(
    'get_layers',
    `Get the full layer tree for a page. Returns all layers with their design properties,
text content, children, and settings. Use this to understand the current page structure
before making changes.`,
    { page_id: z.string().describe('The page ID') },
    async ({ page_id }) => {
      const layers = await getPageLayers(page_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(layers, null, 2) }] };
    },
  );

  server.tool(
    'add_layer',
    `Add a new element to a page.

ELEMENT TYPES:
- Structure: div, section, container, hr
- Content: heading (h1), text (paragraph), richText (rich text block with formatting)
- Media: image, video, audio, icon, iframe
- Actions: button
- Forms: form, input, textarea
- Utilities: htmlEmbed, slider, lightbox

NESTING RULES:
- Leaf elements (image, text, input, video, icon, etc.) CANNOT have children
- Sections cannot contain other sections`,
    {
      page_id: z.string().describe('The page ID'),
      parent_layer_id: z.string().describe('ID of the parent layer to insert into'),
      position: z.number().optional().describe('Index within parent children. Omit to append at end.'),
      template: templateEnum.describe('Element template to create'),
      text_content: z.string().optional().describe('For text/heading/button/richText: plain display text'),
      rich_content: z.array(richTextBlockSchema).optional()
        .describe('For richText: structured content blocks. Overrides text_content.'),
      custom_name: z.string().optional().describe('Custom display name for the layer'),
    },
    async ({ page_id, parent_layer_id, position, template, text_content, rich_content, custom_name }) => {
      const layers = await getPageLayers(page_id);

      const parent = findLayerById(layers, parent_layer_id);
      if (!parent) {
        return { content: [{ type: 'text' as const, text: `Error: Parent layer "${parent_layer_id}" not found.` }], isError: true };
      }
      if (!canHaveChildren(parent)) {
        return { content: [{ type: 'text' as const, text: `Error: "${parent.customName || parent.name}" cannot have children.` }], isError: true };
      }
      if (parent.name === 'section' && template === 'section') {
        return { content: [{ type: 'text' as const, text: 'Error: Sections cannot contain other sections.' }], isError: true };
      }

      const newLayer = createLayerFromTemplate(template, {
        customName: custom_name,
        textContent: text_content,
        richContent: rich_content as RichTextBlock[] | undefined,
      });
      if (!newLayer) {
        return { content: [{ type: 'text' as const, text: `Error: Unknown template "${template}".` }], isError: true };
      }

      const updated = insertLayer(layers, parent_layer_id, newLayer, position);
      await savePageLayers(page_id, updated);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Added ${template} "${custom_name || newLayer.customName || template}" to page`,
            layer_id: newLayer.id,
            parent_layer_id,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_layer_design',
    `Update the visual design of a layer. Merges design properties into existing design
and regenerates Tailwind CSS classes.

IMPORTANT: Set isActive: true on any design category you want to apply.

HOVER/FOCUS STATES: Set ui_state to apply styles only on hover, focus, or active.
Example: { backgrounds: { isActive: true, backgroundColor: "#3b82f6" }, ui_state: "hover" }
produces the class "hover:bg-[#3b82f6]".

GRADIENTS: Use bgGradientVars in backgrounds to set CSS gradients.
Example: { backgrounds: { isActive: true, bgGradientVars: { "--bg-img": "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" } } }
For gradient text: also set backgroundClip: "text" and color to "transparent".`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to update'),
      breakpoint: z.enum(['desktop', 'tablet', 'mobile']).default('desktop')
        .describe('Responsive breakpoint. Desktop is default.'),
      ui_state: z.enum(['neutral', 'hover', 'focus', 'active', 'disabled']).default('neutral')
        .describe('UI state to style. Use "hover" for hover effects, "focus" for focus styles, etc.'),
      design: designSchema,
    },
    async ({ page_id, layer_id, breakpoint, ui_state, design }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, (l) =>
        applyDesignToLayer(l, design as Record<string, Record<string, unknown>>, breakpoint, ui_state),
      );

      await savePageLayers(page_id, updated);

      const updatedLayer = findLayerById(updated, layer_id);
      const stateLabel = ui_state !== 'neutral' ? ` (${ui_state} state)` : '';
      const bpLabel = breakpoint !== 'desktop' ? ` [${breakpoint}]` : '';
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Updated design for "${updatedLayer?.customName || updatedLayer?.name}"${stateLabel}${bpLabel}`,
            layer_id,
            classes: updatedLayer?.classes,
            design: updatedLayer?.design,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_layer_text',
    'Update the text content of a text, heading, or button layer. For richText layers with formatting, use set_rich_text_content instead.',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to update'),
      text: z.string().describe('New text content'),
    },
    async ({ page_id, layer_id, text }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: {
          ...l.variables,
          text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(text) } },
        },
      }));

      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Updated text for "${layer.customName || layer.name}" to "${text}"` }] };
    },
  );

  server.tool(
    'set_rich_text_content',
    `Set the content of a richText layer using structured blocks. Supports headings, paragraphs, lists, blockquotes, code blocks, and horizontal rules. Text supports inline formatting: **bold**, *italic*, [link text](url).`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The richText layer ID'),
      blocks: z.array(z.object({
        type: z.enum(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule']),
        text: z.string().optional().describe('Text content. Supports **bold**, *italic*, [link](url).'),
        level: z.number().optional().describe('Heading level 1-6 (for heading type only)'),
        items: z.array(z.string()).optional().describe('List items (for bulletList/orderedList only)'),
      })).min(1).describe('Content blocks to set'),
    },
    async ({ page_id, layer_id, blocks }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const tiptapDoc = buildTiptapDoc(blocks as RichTextBlock[]);

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: {
          ...l.variables,
          text: { type: 'dynamic_rich_text', data: { content: tiptapDoc } },
        },
      }));

      await savePageLayers(page_id, updated);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Set rich text content for "${layer.customName || layer.name}" (${blocks.length} blocks)`,
            layer_id,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'delete_layer',
    'Remove a layer and all its children from a page',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to delete'),
    },
    async ({ page_id, layer_id }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      if (layer.restrictions?.delete === false) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer.customName || layer.name}" cannot be deleted.` }], isError: true };
      }

      const updated = removeLayer(layers, layer_id);
      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Deleted layer "${layer.customName || layer.name}" (${layer_id})` }] };
    },
  );

  server.tool(
    'move_layer',
    'Move a layer to a different parent or position within the page tree',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to move'),
      new_parent_id: z.string().describe('The new parent layer ID'),
      position: z.number().optional().describe('Position within new parent. Omit to append at end.'),
    },
    async ({ page_id, layer_id, new_parent_id, position }) => {
      const layers = await getPageLayers(page_id);

      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      const newParent = findLayerById(layers, new_parent_id);
      if (!newParent) {
        return { content: [{ type: 'text' as const, text: `Error: New parent "${new_parent_id}" not found.` }], isError: true };
      }
      if (!canHaveChildren(newParent)) {
        return { content: [{ type: 'text' as const, text: `Error: "${newParent.customName || newParent.name}" cannot have children.` }], isError: true };
      }

      const updated = moveLayerInTree(layers, layer_id, new_parent_id, position);
      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Moved "${layer.customName || layer.name}" into "${newParent.customName || newParent.name}"` }] };
    },
  );

  server.tool(
    'update_layer_image',
    'Set the image source of an image layer using an asset ID (from upload_asset or list_assets). Optionally set alt text.',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The image layer ID'),
      asset_id: z.string().describe('Asset ID from the asset library'),
      alt: z.string().optional().describe('Image alt text for accessibility'),
    },
    async ({ page_id, layer_id, asset_id, alt }) => {
      const layers = await getPageLayers(page_id);
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: {
          ...l.variables,
          image: {
            src: { type: 'asset' as const, data: { asset_id } },
            alt: { type: 'dynamic_text' as const, data: { content: alt || '' } },
          },
        },
      }));

      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Set image for "${layer.customName || layer.name}" to asset ${asset_id}` }] };
    },
  );

  server.tool(
    'update_layer_link',
    `Configure a link on any layer (button, div, text, image, etc.).

LINK TYPES:
- url: External URL (e.g. "https://example.com")
- page: Link to another page in the site. Pass collection_item_id alongside page_id_target to link to a specific dynamic-page item.
- email: Mailto link
- phone: Tel link
- asset: Download link to an asset
- anchor: Set anchor_layer_id (and optionally page_id_target) to jump to a specific layer on the same or another page.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID'),
      link_type: z.enum(['url', 'email', 'phone', 'asset', 'page']).describe('Type of link'),
      url: z.string().optional().describe('For url type: the target URL'),
      page_id_target: z.string().optional().describe('For page type: the target page ID'),
      collection_item_id: z.string().optional().describe('For dynamic page links: the specific collection item the link should resolve to. Omit to use the current item at runtime.'),
      email: z.string().optional().describe('For email type: the email address'),
      phone: z.string().optional().describe('For phone type: the phone number'),
      asset_id: z.string().optional().describe('For asset type: the asset ID to download'),
      anchor_layer_id: z.string().optional().describe('Layer ID to scroll to as an in-page anchor. Combine with link_type "url" to link to "#layer" on the same page, or with link_type "page" to link to "#layer" on another page.'),
      target: z.enum(['_blank', '_self', '_parent', '_top']).optional().describe('Link target. _blank opens new tab.'),
      rel: z.string().optional().describe('rel attribute, e.g. "noopener noreferrer", "nofollow", "sponsored", "ugc"'),
      download: z.boolean().optional().describe('When true, instruct the browser to download the linked resource instead of navigating.'),
    },
    async ({ page_id, layer_id, link_type, url, page_id_target, collection_item_id, email, phone, asset_id, anchor_layer_id, target, rel, download }) => {
      const layers = await getPageLayers(page_id);
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const link: LinkSettings = { type: link_type };
      if (link_type === 'url' && url) link.url = { type: 'dynamic_text', data: { content: url } };
      if (link_type === 'email' && email) link.email = { type: 'dynamic_text', data: { content: email } };
      if (link_type === 'phone' && phone) link.phone = { type: 'dynamic_text', data: { content: phone } };
      if (link_type === 'asset' && asset_id) link.asset = { id: asset_id };
      if (link_type === 'page' && page_id_target) {
        link.page = collection_item_id
          ? { id: page_id_target, collection_item_id }
          : { id: page_id_target };
      }
      if (anchor_layer_id) link.anchor_layer_id = anchor_layer_id;
      if (target) link.target = target;
      if (rel !== undefined) link.rel = rel;
      if (download !== undefined) link.download = download;

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: { ...l.variables, link },
      }));

      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Set ${link_type} link on "${layer.customName || layer.name}"` }] };
    },
  );

  server.tool(
    'update_layer_video',
    'Set the video source of a video layer. Supports asset IDs, YouTube video IDs, or direct URLs.',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The video layer ID'),
      source_type: z.enum(['asset', 'youtube', 'url']).describe('Video source type'),
      asset_id: z.string().optional().describe('For asset type: asset ID'),
      youtube_id: z.string().optional().describe('For youtube type: YouTube video ID (e.g. "dQw4w9WgXcQ")'),
      url: z.string().optional().describe('For url type: direct video URL'),
      poster_asset_id: z.string().optional().describe('Asset ID for poster/thumbnail image'),
    },
    async ({ page_id, layer_id, source_type, asset_id, youtube_id, url, poster_asset_id }) => {
      const layers = await getPageLayers(page_id);
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      let src;
      if (source_type === 'asset' && asset_id) src = { type: 'asset' as const, data: { asset_id } };
      else if (source_type === 'youtube' && youtube_id) src = { type: 'video' as const, data: { provider: 'youtube' as const, video_id: youtube_id } };
      else if (source_type === 'url' && url) src = { type: 'dynamic_text' as const, data: { content: url } };
      else return { content: [{ type: 'text' as const, text: 'Error: Provide asset_id, youtube_id, or url matching the source_type.' }], isError: true };

      const videoVar: Record<string, unknown> = { src };
      if (poster_asset_id) videoVar.poster = { type: 'asset', data: { asset_id: poster_asset_id } };

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: { ...l.variables, video: videoVar },
      }));

      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Set video source for "${layer.customName || layer.name}"` }] };
    },
  );

  server.tool(
    'update_layer_background_image',
    'Set a background image on any layer using an asset ID or URL.',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID'),
      asset_id: z.string().optional().describe('Asset ID for the background image'),
      url: z.string().optional().describe('Direct URL for the background image'),
    },
    async ({ page_id, layer_id, asset_id, url }) => {
      const layers = await getPageLayers(page_id);
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      if (!asset_id && !url) {
        return { content: [{ type: 'text' as const, text: 'Error: Provide either asset_id or url.' }], isError: true };
      }

      const src = asset_id
        ? { type: 'asset' as const, data: { asset_id } }
        : { type: 'dynamic_text' as const, data: { content: url! } };

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: { ...l.variables, backgroundImage: { src } },
      }));

      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Set background image for "${layer.customName || layer.name}"` }] };
    },
  );

  server.tool(
    'update_layer_settings',
    `Update layer settings like HTML tag, custom ID, custom attributes, embed code, visibility,
and per-element configuration (slider, lightbox, map, select options, filter, placeholder option).

COMMON USES:
- Change heading level: tag "h1", "h2", "h3", etc.
- Set HTML embed code: html_embed_code "<script>..."
- Add custom attributes: custom_attributes { "data-analytics": "hero" }
- Set custom HTML ID: html_id "my-section"
- Hide a layer from the canvas: hidden true
- Configure slider: slider { autoplay: true, delay: "5", loop: "loop", pagination: true }
- Configure lightbox: lightbox { thumbnails: true, zoom: true, navigation: true }
- Bind lightbox to a CMS multi-image field: lightbox { files_source: "cms", files_field_id: "<field id>" }
- Configure map: map { provider: "mapbox", latitude: 40.7128, longitude: -74.006, zoom: 12 }
- Bind select / checkbox / radio to a CMS collection: options_source { collection_id: "<id>", sort_field_id: "<id>", sort_order: "asc" }
- Mark a <option> as the placeholder: is_placeholder true
- Trigger filter element on every change: filter_on_change true`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID'),
      tag: z.string().optional().describe('HTML tag override: h1, h2, h3, h4, h5, h6, p, span, div, section, nav, footer, header, main, aside, article'),
      html_id: z.string().optional().describe('Custom HTML element ID (for anchor links, CSS targeting)'),
      html_embed_code: z.string().optional().describe('For htmlEmbed layers: the HTML/CSS/JS code to embed'),
      custom_attributes: z.record(z.string(), z.string()).optional().describe('Custom HTML attributes as { name: value } pairs'),
      custom_name: z.string().optional().describe('Display name for the layer in the builder'),
      hidden: z.boolean().optional().describe('Hide the layer on the canvas (still renders on the published site).'),
      filter_on_change: z.boolean().optional().describe('For filter layers: trigger filtering on every input change (debounced).'),
      is_placeholder: z.boolean().optional().describe('For <option> children of <select>: mark this option as the disabled placeholder.'),
      slider: z.object({
        navigation: z.boolean().optional().describe('Show prev/next arrows'),
        pagination: z.boolean().optional().describe('Show pagination bullets'),
        pagination_type: z.enum(['bullets', 'fraction']).optional().describe('Pagination style'),
        pagination_clickable: z.boolean().optional(),
        autoplay: z.boolean().optional().describe('Auto-advance slides'),
        pause_on_hover: z.boolean().optional().describe('Pause autoplay on hover'),
        delay: z.string().optional().describe('Autoplay delay in seconds (e.g. "3", "5")'),
        loop: z.enum(['none', 'loop', 'rewind']).optional().describe('Loop mode'),
        animation_effect: z.enum(['slide', 'fade', 'cube', 'coverflow', 'flip', 'cards']).optional(),
        duration: z.string().optional().describe('Transition duration in seconds (e.g. "0.5")'),
        easing: z.string().optional(),
        centered: z.boolean().optional().describe('Center active slide'),
        mousewheel: z.boolean().optional().describe('Navigate with scroll wheel'),
        touch_events: z.boolean().optional(),
        slide_to_clicked: z.boolean().optional(),
        slides_per_group: z.number().optional(),
        group_slide: z.number().optional(),
      }).optional().describe('Slider settings (only for slider layers)'),
      lightbox: z.object({
        files_source: z.enum(['files', 'cms']).optional().describe('"files" for a hand-picked list, "cms" to bind to a multi-image CMS field'),
        files: z.array(z.string()).optional().describe('For files_source "files": array of asset IDs or external URLs'),
        files_field_id: z.string().nullable().optional().describe('For files_source "cms": the CMS field ID to read images from (must be a multi-asset field on the surrounding collection layer)'),
        thumbnails: z.boolean().optional().describe('Show thumbnails strip'),
        navigation: z.boolean().optional().describe('Show prev/next arrows'),
        pagination: z.boolean().optional().describe('Show pagination'),
        zoom: z.boolean().optional().describe('Enable pinch-to-zoom'),
        double_tap_zoom: z.boolean().optional().describe('Enable double-tap zoom'),
        mousewheel: z.boolean().optional().describe('Navigate with scroll wheel'),
        overlay: z.enum(['light', 'dark']).optional().describe('Overlay background style'),
        group_id: z.string().optional().describe('Links multiple lightboxes into one shared gallery'),
        animation_effect: z.enum(['slide', 'fade', 'cube', 'coverflow', 'flip', 'cards']).optional(),
        easing: z.string().optional(),
        duration: z.string().optional().describe('Transition duration in seconds'),
      }).optional().describe('Lightbox settings (only for lightbox layers)'),
      map: z.object({
        provider: z.enum(['mapbox', 'google']).optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
        zoom: z.number().optional(),
        marker_color: z.string().nullable().optional(),
        search: z.string().optional().describe('Address / place to geocode (alternative to lat/lng)'),
        style: z.string().optional().describe('Provider-specific style key. Sets <provider>.style.'),
        interactive: z.boolean().optional(),
        scroll_zoom: z.boolean().optional(),
        show_nav_control: z.boolean().optional(),
        show_scale_bar: z.boolean().optional(),
      }).optional().describe('Map settings (only for map layers)'),
      options_source: z.object({
        collection_id: z.string().describe('Collection to source options from'),
        default_item_id: z.string().optional().describe('Item ID to pre-select (for <select>)'),
        default_item_ids: z.array(z.string()).optional().describe('Item IDs to pre-check (for checkbox groups)'),
        sort_field_id: z.string().optional().describe('Field ID to sort by (omit for manual order)'),
        sort_order: z.enum(['asc', 'desc']).optional(),
      }).nullable().optional().describe('Bind a select / checkbox / radio element to a CMS collection. Pass null to clear.'),
    },
    async ({
      page_id, layer_id, tag, html_id, html_embed_code, custom_attributes, custom_name,
      hidden, filter_on_change, is_placeholder, slider, lightbox, map, options_source,
    }) => {
      const layers = await getPageLayers(page_id);
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, (l) => {
        const settings = { ...l.settings };
        if (tag) settings.tag = tag;
        if (html_id) settings.id = html_id;
        if (hidden !== undefined) settings.hidden = hidden;
        if (filter_on_change !== undefined) settings.filterOnChange = filter_on_change;
        if (is_placeholder !== undefined) settings.isPlaceholder = is_placeholder;
        if (custom_attributes) settings.customAttributes = { ...settings.customAttributes, ...custom_attributes };
        if (html_embed_code !== undefined) settings.htmlEmbed = { ...settings.htmlEmbed, code: html_embed_code };
        if (slider) {
          const existing = settings.slider || {} as Record<string, unknown>;
          settings.slider = {
            ...existing,
            ...(slider.navigation !== undefined && { navigation: slider.navigation }),
            ...(slider.pagination !== undefined && { pagination: slider.pagination }),
            ...(slider.pagination_type !== undefined && { paginationType: slider.pagination_type }),
            ...(slider.pagination_clickable !== undefined && { paginationClickable: slider.pagination_clickable }),
            ...(slider.autoplay !== undefined && { autoplay: slider.autoplay }),
            ...(slider.pause_on_hover !== undefined && { pauseOnHover: slider.pause_on_hover }),
            ...(slider.delay !== undefined && { delay: slider.delay }),
            ...(slider.loop !== undefined && { loop: slider.loop }),
            ...(slider.animation_effect !== undefined && { animationEffect: slider.animation_effect }),
            ...(slider.duration !== undefined && { duration: slider.duration }),
            ...(slider.easing !== undefined && { easing: slider.easing }),
            ...(slider.centered !== undefined && { centered: slider.centered }),
            ...(slider.mousewheel !== undefined && { mousewheel: slider.mousewheel }),
            ...(slider.touch_events !== undefined && { touchEvents: slider.touch_events }),
            ...(slider.slide_to_clicked !== undefined && { slideToClicked: slider.slide_to_clicked }),
            ...(slider.slides_per_group !== undefined && { slidesPerGroup: slider.slides_per_group }),
            ...(slider.group_slide !== undefined && { groupSlide: slider.group_slide }),
          } as typeof settings.slider;
        }
        if (lightbox) {
          const existing = (settings.lightbox || {}) as Record<string, unknown>;
          const next = { ...existing } as Record<string, unknown>;
          if (lightbox.files_source !== undefined) next.filesSource = lightbox.files_source;
          if (lightbox.files !== undefined) next.files = lightbox.files;
          if (lightbox.files_field_id !== undefined) {
            next.filesField = lightbox.files_field_id
              ? { type: 'field', data: { field_id: lightbox.files_field_id, field_type: 'image', relationships: [] } }
              : null;
          }
          if (lightbox.thumbnails !== undefined) next.thumbnails = lightbox.thumbnails;
          if (lightbox.navigation !== undefined) next.navigation = lightbox.navigation;
          if (lightbox.pagination !== undefined) next.pagination = lightbox.pagination;
          if (lightbox.zoom !== undefined) next.zoom = lightbox.zoom;
          if (lightbox.double_tap_zoom !== undefined) next.doubleTapZoom = lightbox.double_tap_zoom;
          if (lightbox.mousewheel !== undefined) next.mousewheel = lightbox.mousewheel;
          if (lightbox.overlay !== undefined) next.overlay = lightbox.overlay;
          if (lightbox.group_id !== undefined) next.groupId = lightbox.group_id;
          if (lightbox.animation_effect !== undefined) next.animationEffect = lightbox.animation_effect;
          if (lightbox.easing !== undefined) next.easing = lightbox.easing;
          if (lightbox.duration !== undefined) next.duration = lightbox.duration;
          settings.lightbox = next as unknown as typeof settings.lightbox;
        }
        if (map) {
          const existing = (settings.map || {}) as Record<string, unknown>;
          const next = { ...existing } as Record<string, unknown>;
          if (map.provider !== undefined) next.provider = map.provider;
          if (map.latitude !== undefined) next.latitude = map.latitude;
          if (map.longitude !== undefined) next.longitude = map.longitude;
          if (map.zoom !== undefined) next.zoom = map.zoom;
          if (map.marker_color !== undefined) next.markerColor = map.marker_color;
          if (map.search !== undefined) next.search = map.search;
          const providerKey = (map.provider || existing.provider || 'mapbox') as 'mapbox' | 'google';
          const providerSettings = { ...((existing[providerKey] as Record<string, unknown>) || {}) };
          if (map.style !== undefined) providerSettings.style = map.style;
          if (map.interactive !== undefined) providerSettings.interactive = map.interactive;
          if (map.scroll_zoom !== undefined) providerSettings.scrollZoom = map.scroll_zoom;
          if (map.show_nav_control !== undefined) providerSettings.showNavControl = map.show_nav_control;
          if (map.show_scale_bar !== undefined) providerSettings.showScaleBar = map.show_scale_bar;
          if (Object.keys(providerSettings).length > 0) next[providerKey] = providerSettings;
          settings.map = next as unknown as typeof settings.map;
        }
        if (options_source !== undefined) {
          settings.optionsSource = options_source === null ? undefined : {
            collectionId: options_source.collection_id,
            ...(options_source.default_item_id !== undefined && { defaultItemId: options_source.default_item_id }),
            ...(options_source.default_item_ids !== undefined && { defaultItemIds: options_source.default_item_ids }),
            ...(options_source.sort_field_id !== undefined && { sortFieldId: options_source.sort_field_id }),
            ...(options_source.sort_order !== undefined && { sortOrder: options_source.sort_order }),
          };
        }

        return {
          ...l,
          settings,
          ...(custom_name ? { customName: custom_name } : {}),
        };
      });

      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Updated settings for "${layer.customName || layer.name}"` }] };
    },
  );

  server.tool(
    'export_layer_html',
    `Render a layer (and its descendants) to a self-contained HTML string with Tailwind
classes preserved. Useful for copying a section, sharing markup, or seeding another
page via the HTML import flow.`,
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The layer ID to export'),
    },
    async ({ page_id, layer_id }) => {
      const layers = await getPageLayers(page_id);
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }
      const html = layerToExportHtml(layer);
      return { content: [{ type: 'text' as const, text: html }] };
    },
  );

  server.tool(
    'update_layer_iframe',
    'Set the source URL for an iframe layer.',
    {
      page_id: z.string().describe('The page ID'),
      layer_id: z.string().describe('The iframe layer ID'),
      url: z.string().describe('The URL to embed in the iframe'),
    },
    async ({ page_id, layer_id, url }) => {
      const layers = await getPageLayers(page_id);
      const layer = findLayerById(layers, layer_id);
      if (!layer) {
        return { content: [{ type: 'text' as const, text: `Error: Layer "${layer_id}" not found.` }], isError: true };
      }

      const updated = updateLayerById(layers, layer_id, (l) => ({
        ...l,
        variables: {
          ...l.variables,
          iframe: { src: { type: 'dynamic_text' as const, data: { content: url } } },
        },
      }));

      await savePageLayers(page_id, updated);
      return { content: [{ type: 'text' as const, text: `Set iframe URL for "${layer.customName || layer.name}" to "${url}"` }] };
    },
  );
}
