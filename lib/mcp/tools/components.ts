import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Breakpoint, ComponentVariable, ComponentVariableValue, ComponentVariant, Layer, UIState } from '@/types';
import {
  getAllComponents,
  getComponentById,
  createComponent,
  updateComponent,
  softDeleteComponent,
} from '@/lib/repositories/componentRepository';
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
  generateId,
} from '@/lib/mcp/utils';
import type { RichTextBlock } from '@/lib/mcp/utils';
import {
  broadcastComponentCreated,
  broadcastComponentUpdated,
  broadcastComponentDeleted,
  broadcastComponentLayersUpdated,
} from '@/lib/mcp/broadcast';
import { designSchema, richTextBlockSchema, templateEnum } from './shared-schemas';

const variableTypeEnum = z.enum(['text', 'rich_text', 'image', 'link', 'audio', 'video', 'icon', 'variant'])
  .describe('Variable type. "variant" lets instances pick which variant of a nested component is rendered.');

const variableSchema = z.object({
  name: z.string().describe('Display name (e.g. "Button label", "Hero image")'),
  type: variableTypeEnum.default('text'),
  placeholder: z.string().optional()
    .describe('Placeholder text shown in the override input on each instance.'),
  default_value: z.unknown().optional()
    .describe('Default value applied when an instance does not override the variable. Shape matches the variable type (e.g. { type: "dynamic_text", data: { content: "Click me" } } for text).'),
});

const variableUpdateSchema = z.object({
  id: z.string().optional().describe('Existing variable ID to update, or omit to create new'),
  name: z.string().describe('Variable display name'),
  type: variableTypeEnum.default('text'),
  placeholder: z.string().optional(),
  default_value: z.unknown().optional(),
});

function normalizeVariables(input: Array<z.infer<typeof variableUpdateSchema>>): ComponentVariable[] {
  return input.map((v) => ({
    id: v.id || generateId(),
    name: v.name,
    type: v.type,
    ...(v.placeholder !== undefined && { placeholder: v.placeholder }),
    ...(v.default_value !== undefined && { default_value: v.default_value as ComponentVariableValue }),
  }));
}

export function registerComponentTools(server: McpServer) {
  server.tool(
    'list_components',
    'List all reusable components with their variables',
    {},
    async () => {
      const components = await getAllComponents(false);
      const summary = components.map((c) => ({
        id: c.id,
        name: c.name,
        variables: c.variables || [],
        layer_count: countLayers(c.layers),
        is_published: c.is_published,
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.tool(
    'get_component',
    'Get a component by ID, including its full layer tree and variables',
    { component_id: z.string().describe('The component ID') },
    async ({ component_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(component, null, 2) }],
      };
    },
  );

  server.tool(
    'create_component',
    `Create a new reusable component. A component is a layer tree with optional variables.

Variables let each instance of the component override specific content (text, images, links).
When defining variables, you get back variable IDs. Then link them to layers by setting
the variable's ID on the layer's variable reference (e.g. layer.variables.text.id = variable_id).

EXAMPLE: A "Card" component with a title variable:
1. Create component with variables: [{ name: "Card title", type: "text" }]
2. The response includes the variable IDs
3. Update the component's layers to link the variable to a text layer`,
    {
      name: z.string().describe('Component name (e.g. "Hero Section", "Feature Card")'),
      variables: z.array(variableSchema).optional()
        .describe('Component variables for content overrides per instance'),
    },
    async ({ name, variables }) => {
      const rootLayer: Layer = {
        id: generateId(),
        name: 'div',
        customName: name,
        classes: '',
        children: [],
      };

      const componentVariables = variables ? normalizeVariables(variables) : undefined;

      const component = await createComponent({
        name,
        layers: [rootLayer],
        variables: componentVariables,
      });

      broadcastComponentCreated(component).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Component "${name}" created`,
            id: component.id,
            root_layer_id: rootLayer.id,
            variables: component.variables || [],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_component',
    'Update a component\'s name and/or variables. Use update_component_layers to modify the layer tree, or the variant tools for variant management.',
    {
      component_id: z.string().describe('The component ID'),
      name: z.string().optional().describe('New component name'),
      variables: z.array(variableUpdateSchema).optional()
        .describe('Full list of variables (replaces existing). Include existing IDs to preserve them; new entries get fresh IDs.'),
    },
    async ({ component_id, name, variables }) => {
      const updates: { name?: string; variables?: ComponentVariable[] } = {};
      if (name !== undefined) updates.name = name;
      if (variables !== undefined) updates.variables = normalizeVariables(variables);

      const component = await updateComponent(component_id, updates);
      broadcastComponentUpdated(component_id, updates).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Component "${component.name}" updated`,
            variables: component.variables || [],
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'list_component_variants',
    'List the named variants of a component. Every component has at least one ("Default"). Variants share the component\'s variables.',
    {
      component_id: z.string().describe('The component ID'),
    },
    async ({ component_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      const variants = (component.variants && component.variants.length > 0)
        ? component.variants
        : [{ id: generateId(), name: 'Default', layers: component.layers || [] }];
      const summary = variants.map((v) => ({
        id: v.id,
        name: v.name,
        layer_count: countLayers(v.layers),
        is_primary: v === variants[0],
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    },
  );

  server.tool(
    'create_component_variant',
    `Add a new named variant to a component. Pass source_variant_id to clone an existing variant
(new layer IDs are generated). Omit it to start from an empty root div.`,
    {
      component_id: z.string().describe('The component ID'),
      name: z.string().describe('Variant name (e.g. "Small", "Dark", "Compact")'),
      source_variant_id: z.string().optional()
        .describe('Variant to clone. Omit for an empty starting tree.'),
    },
    async ({ component_id, name, source_variant_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      const existing: ComponentVariant[] = (component.variants && component.variants.length > 0)
        ? component.variants
        : [{ id: generateId(), name: 'Default', layers: component.layers || [] }];

      let layers: Layer[];
      if (source_variant_id) {
        const source = existing.find((v) => v.id === source_variant_id);
        if (!source) {
          return {
            content: [{ type: 'text' as const, text: `Error: Source variant "${source_variant_id}" not found.` }],
            isError: true,
          };
        }
        layers = source.layers.map(cloneLayerWithNewIds);
      } else {
        layers = [{
          id: generateId(),
          name: 'div',
          customName: name,
          classes: '',
          children: [],
        }];
      }

      const newVariant: ComponentVariant = { id: generateId(), name, layers };
      const updatedVariants = [...existing, newVariant];

      await updateComponent(component_id, { variants: updatedVariants });
      broadcastComponentUpdated(component_id, { variants: updatedVariants }).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Variant "${name}" created`,
            id: newVariant.id,
            root_layer_id: layers[0]?.id,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'update_component_variant',
    'Rename a component variant. Use update_component_layers with variant_id to modify its tree.',
    {
      component_id: z.string().describe('The component ID'),
      variant_id: z.string().describe('The variant ID'),
      name: z.string().describe('New variant name'),
    },
    async ({ component_id, variant_id, name }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      const variants = component.variants || [];
      const idx = variants.findIndex((v) => v.id === variant_id);
      if (idx === -1) {
        return {
          content: [{ type: 'text' as const, text: `Error: Variant "${variant_id}" not found.` }],
          isError: true,
        };
      }
      const updatedVariants = [...variants];
      updatedVariants[idx] = { ...updatedVariants[idx], name };

      await updateComponent(component_id, { variants: updatedVariants });
      broadcastComponentUpdated(component_id, { variants: updatedVariants }).catch(() => {});

      return { content: [{ type: 'text' as const, text: `Variant "${variant_id}" renamed to "${name}"` }] };
    },
  );

  server.tool(
    'delete_component_variant',
    'Delete a named variant. The component must keep at least one variant — the primary cannot be deleted.',
    {
      component_id: z.string().describe('The component ID'),
      variant_id: z.string().describe('The variant ID to delete'),
    },
    async ({ component_id, variant_id }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }
      const variants = component.variants || [];
      if (variants.length <= 1) {
        return {
          content: [{ type: 'text' as const, text: 'Error: A component must keep at least one variant.' }],
          isError: true,
        };
      }
      if (variants[0]?.id === variant_id) {
        return {
          content: [{ type: 'text' as const, text: 'Error: The primary variant cannot be deleted. Reorder variants or delete a non-primary one.' }],
          isError: true,
        };
      }
      const updatedVariants = variants.filter((v) => v.id !== variant_id);
      if (updatedVariants.length === variants.length) {
        return {
          content: [{ type: 'text' as const, text: `Error: Variant "${variant_id}" not found.` }],
          isError: true,
        };
      }

      await updateComponent(component_id, { variants: updatedVariants });
      broadcastComponentUpdated(component_id, { variants: updatedVariants }).catch(() => {});

      return { content: [{ type: 'text' as const, text: `Variant "${variant_id}" deleted` }] };
    },
  );

  server.tool(
    'update_component_layers',
    `Modify a component's layer tree. Works like batch_operations but for component layers.
Use ref_id in add_layer to name layers, then reference them in later operations.

Pass variant_id to target a specific named variant; omit it to update the primary variant
(variants[0]), which is what most components have.`,
    {
      component_id: z.string().describe('The component ID'),
      variant_id: z.string().optional()
        .describe('Variant to modify. Omit to target the primary variant.'),
      operations: z.array(z.discriminatedUnion('type', [
        z.object({
          type: z.literal('add_layer'),
          parent_layer_id: z.string().describe('Parent layer ID or ref_id'),
          position: z.number().optional(),
          template: templateEnum,
          text_content: z.string().optional(),
          rich_content: z.array(richTextBlockSchema).optional()
            .describe('For richText: structured content blocks. Overrides text_content.'),
          custom_name: z.string().optional(),
          ref_id: z.string().optional().describe('Reference ID for later operations'),
          design: designSchema.optional(),
          image_asset_id: z.string().optional().describe('For image layers: asset ID to display'),
          variable_id: z.string().optional()
            .describe('Component variable ID to link to this layer\'s primary content (text/image/link)'),
        }),
        z.object({
          type: z.literal('update_design'),
          layer_id: z.string().describe('Layer ID or ref_id'),
          design: designSchema,
          breakpoint: z.enum(['desktop', 'tablet', 'mobile']).default('desktop').optional(),
          ui_state: z.enum(['neutral', 'hover', 'focus', 'active', 'disabled']).default('neutral').optional()
            .describe('UI state: "hover" for hover styles, "focus" for focus, etc.'),
        }),
        z.object({
          type: z.literal('update_text'),
          layer_id: z.string().describe('Layer ID or ref_id'),
          text: z.string(),
        }),
        z.object({
          type: z.literal('update_image'),
          layer_id: z.string().describe('Layer ID or ref_id'),
          asset_id: z.string().describe('Asset ID from upload_asset'),
        }),
        z.object({
          type: z.literal('set_rich_text'),
          layer_id: z.string().describe('RichText layer ID or ref_id'),
          blocks: z.array(richTextBlockSchema).min(1)
            .describe('Content blocks (paragraph, heading, list, etc.)'),
        }),
        z.object({
          type: z.literal('apply_style'),
          layer_id: z.string(),
          style_id: z.string().describe('Layer style ID to apply'),
        }),
        z.object({
          type: z.literal('delete_layer'),
          layer_id: z.string(),
        }),
        z.object({
          type: z.literal('move_layer'),
          layer_id: z.string(),
          new_parent_id: z.string(),
          position: z.number().optional(),
        }),
        z.object({
          type: z.literal('link_variable'),
          layer_id: z.string().describe('Layer ID or ref_id'),
          variable_id: z.string().describe('Component variable ID to link'),
          variable_type: variableTypeEnum.default('text'),
        }),
      ])).min(1).max(50),
    },
    async ({ component_id, variant_id, operations }) => {
      const component = await getComponentById(component_id);
      if (!component) {
        return {
          content: [{ type: 'text' as const, text: `Error: Component "${component_id}" not found.` }],
          isError: true,
        };
      }

      const variants: ComponentVariant[] = (component.variants && component.variants.length > 0)
        ? component.variants
        : [{ id: generateId(), name: 'Default', layers: component.layers || [] }];
      const targetIdx = variant_id
        ? variants.findIndex((v) => v.id === variant_id)
        : 0;
      if (targetIdx === -1) {
        return {
          content: [{ type: 'text' as const, text: `Error: Variant "${variant_id}" not found.` }],
          isError: true,
        };
      }

      let layers = variants[targetIdx].layers || [];
      const refMap = new Map<string, string>();
      const results: Array<{ op: number; status: string; detail: string }> = [];

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        try {
          switch (op.type) {
            case 'add_layer': {
              const parentId = refMap.get(op.parent_layer_id) || op.parent_layer_id;
              const parent = findLayerById(layers, parentId);
              if (!parent) { results.push({ op: i, status: 'error', detail: `Parent "${op.parent_layer_id}" not found` }); continue; }
              if (!canHaveChildren(parent)) { results.push({ op: i, status: 'error', detail: `"${parent.customName || parent.name}" cannot have children` }); continue; }

              let newLayer = createLayerFromTemplate(op.template, {
                customName: op.custom_name,
                textContent: op.text_content,
                richContent: op.rich_content as RichTextBlock[] | undefined,
              });
              if (!newLayer) { results.push({ op: i, status: 'error', detail: `Unknown template "${op.template}"` }); continue; }

              if (op.design) {
                newLayer = applyDesignToLayer(newLayer, op.design as Record<string, Record<string, unknown>>);
              }

              if (op.image_asset_id && newLayer.variables?.image) {
                newLayer.variables = {
                  ...newLayer.variables,
                  image: { ...newLayer.variables.image, src: { type: 'asset', data: { asset_id: op.image_asset_id } } },
                };
              }

              if (op.variable_id) {
                newLayer = linkVariableToLayer(newLayer, op.variable_id, op.template);
              }

              if (op.ref_id) refMap.set(op.ref_id, newLayer.id);
              layers = insertLayer(layers, parentId, newLayer, op.position);
              results.push({ op: i, status: 'ok', detail: `Added ${op.template} (id: ${newLayer.id})` });
              break;
            }

            case 'update_design': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const bp = (op.breakpoint ?? 'desktop') as Breakpoint;
              const state = (op.ui_state ?? 'neutral') as UIState;
              layers = updateLayerById(layers, layerId, (l) =>
                applyDesignToLayer(l, op.design as Record<string, Record<string, unknown>>, bp, state),
              );
              results.push({ op: i, status: 'ok', detail: `Styled "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_text': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => ({
                ...l,
                variables: {
                  ...l.variables,
                  text: { type: 'dynamic_rich_text', data: { content: getTiptapTextContent(op.text) } },
                },
              }));
              results.push({ op: i, status: 'ok', detail: `Set text on "${layer.customName || layer.name}"` });
              break;
            }

            case 'update_image': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => {
                const existing = (l.variables?.image || {}) as Record<string, unknown>;
                return {
                  ...l,
                  variables: {
                    ...l.variables,
                    image: {
                      ...existing,
                      src: { type: 'asset' as const, data: { asset_id: op.asset_id } },
                      alt: (existing.alt || { type: 'dynamic_text' as const, data: { content: '' } }) as { type: 'dynamic_text'; data: { content: string } },
                    },
                  },
                };
              });
              results.push({ op: i, status: 'ok', detail: `Set image on "${layer.customName || layer.name}"` });
              break;
            }

            case 'set_rich_text': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              const tiptapDoc = buildTiptapDoc(op.blocks as RichTextBlock[]);
              layers = updateLayerById(layers, layerId, (l) => ({
                ...l,
                variables: { ...l.variables, text: { type: 'dynamic_rich_text', data: { content: tiptapDoc } } },
              }));
              results.push({ op: i, status: 'ok', detail: `Set rich text on "${layer.customName || layer.name}" (${op.blocks.length} blocks)` });
              break;
            }

            case 'apply_style': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) => ({ ...l, styleId: op.style_id }));
              results.push({ op: i, status: 'ok', detail: `Applied style to "${layer.customName || layer.name}"` });
              break;
            }

            case 'delete_layer': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = removeLayer(layers, layerId);
              results.push({ op: i, status: 'ok', detail: `Deleted "${layer.customName || layer.name}"` });
              break;
            }

            case 'move_layer': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const newParentId = refMap.get(op.new_parent_id) || op.new_parent_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = moveLayerInTree(layers, layerId, newParentId, op.position);
              results.push({ op: i, status: 'ok', detail: `Moved "${layer.customName || layer.name}"` });
              break;
            }

            case 'link_variable': {
              const layerId = refMap.get(op.layer_id) || op.layer_id;
              const layer = findLayerById(layers, layerId);
              if (!layer) { results.push({ op: i, status: 'error', detail: `Layer "${op.layer_id}" not found` }); continue; }
              layers = updateLayerById(layers, layerId, (l) =>
                linkVariableToLayer(l, op.variable_id, op.variable_type),
              );
              results.push({ op: i, status: 'ok', detail: `Linked variable to "${layer.customName || layer.name}"` });
              break;
            }
          }
        } catch (err) {
          results.push({ op: i, status: 'error', detail: err instanceof Error ? err.message : 'Unknown error' });
        }
      }

      const errors = results.filter((r) => r.status === 'error');
      if (errors.length === operations.length) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ message: 'All operations failed', results }, null, 2) }],
          isError: true,
        };
      }

      const updatedVariants = variants.map((v, i) => (i === targetIdx ? { ...v, layers } : v));
      await updateComponent(component_id, { variants: updatedVariants });
      broadcastComponentLayersUpdated(component_id, updatedVariants[0].layers).catch(() => {});

      const refEntries = Object.fromEntries(refMap);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Executed ${results.filter((r) => r.status === 'ok').length}/${operations.length} operations`,
            ref_ids: Object.keys(refEntries).length > 0 ? refEntries : undefined,
            results,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'delete_component',
    'Delete a component. This detaches it from all pages and components that use it.',
    { component_id: z.string().describe('The component ID to delete') },
    async ({ component_id }) => {
      const result = await softDeleteComponent(component_id);
      broadcastComponentDeleted(component_id).catch(() => {});

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            message: `Component "${result.component.name}" deleted`,
            affected_entities: result.affectedEntities.map((e) => ({
              type: e.type,
              name: e.name,
            })),
          }, null, 2),
        }],
      };
    },
  );
}

function countLayers(layers: Layer[]): number {
  let count = 0;
  for (const layer of layers) {
    count += 1;
    if (layer.children) count += countLayers(layer.children);
  }
  return count;
}

/**
 * Deep-clone a layer, regenerating IDs for the whole subtree.
 * Used when cloning a variant so the new variant has fresh layer IDs.
 */
function cloneLayerWithNewIds(layer: Layer): Layer {
  return {
    ...layer,
    id: generateId('lyr'),
    ...(layer.children && Array.isArray(layer.children) && {
      children: layer.children.map(cloneLayerWithNewIds),
    }),
  };
}

/**
 * Link a component variable to a layer's primary content slot.
 * Sets the variable's `id` field so the component system resolves overrides.
 */
function linkVariableToLayer(layer: Layer, variableId: string, variableType: string): Layer {
  const vars = { ...layer.variables };

  switch (variableType) {
    case 'text':
    case 'rich_text':
      if (vars.text) {
        vars.text = { ...vars.text, id: variableId };
      } else {
        vars.text = {
          id: variableId,
          type: 'dynamic_rich_text',
          data: { content: { type: 'doc', content: [{ type: 'paragraph' }] } },
        };
      }
      break;

    case 'image':
      if (vars.image) {
        vars.image = {
          ...vars.image,
          src: { ...(vars.image.src || { type: 'asset', data: { asset_id: null } }), id: variableId },
        };
      }
      break;

    case 'link':
      if (vars.link) {
        // variable_id is a runtime-only extension on LinkSettings for component variable linking
        (vars.link as unknown as Record<string, unknown>).variable_id = variableId;
      }
      break;

    case 'audio':
      if (vars.audio) {
        vars.audio = {
          ...vars.audio,
          src: { ...(vars.audio.src || { type: 'asset', data: { asset_id: null } }), id: variableId },
        };
      }
      break;

    case 'video':
      if (vars.video) {
        vars.video = {
          ...vars.video,
          src: { ...(vars.video.src || { type: 'asset', data: { asset_id: null } }), id: variableId },
        };
      }
      break;

    case 'icon':
      if (vars.icon) {
        vars.icon = {
          ...vars.icon,
          src: { ...(vars.icon.src || { type: 'asset', data: { asset_id: null } }), id: variableId },
        };
      }
      break;

    case 'variant': {
      // Variant variables target the layer's nested-component variant override.
      // The runtime reads componentVariantId; the variable_id wires up the override slot.
      const next = { ...layer } as Layer & { componentVariantVariableId?: string };
      next.componentVariantVariableId = variableId;
      return { ...next, variables: vars };
    }
  }

  return { ...layer, variables: vars };
}
