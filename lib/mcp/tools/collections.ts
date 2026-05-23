import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { CollectionFieldData, CollectionFieldType, CollectionSorting } from '@/types';
import { getAllCollections, createCollection, updateCollection, deleteCollection } from '@/lib/repositories/collectionRepository';
import {
  getFieldsByCollectionId,
  createField,
  updateField,
  deleteField,
  reorderFields,
} from '@/lib/repositories/collectionFieldRepository';
import {
  getItemsByCollectionId,
  getItemsWithValues,
  createItem,
  updateItem,
  deleteItem,
} from '@/lib/repositories/collectionItemRepository';
import { setValuesByFieldName } from '@/lib/repositories/collectionItemValueRepository';

const fieldTypeEnum = z.enum([
  'text', 'number', 'boolean', 'date', 'date_only',
  'reference', 'multi_reference',
  'rich_text', 'image', 'audio', 'video', 'document',
  'link', 'email', 'phone',
  'color', 'status',
  'option', 'count',
]).describe('Field type (date = datetime, date_only = date without time)');

const optionEntrySchema = z.object({
  id: z.string().describe('Stable option ID (use the same ID when setting this option as a value on items)'),
  name: z.string().describe('Display name shown to editors'),
});

const fieldDataSchema = z.object({
  multiple: z.boolean().optional()
    .describe('For asset fields (image/audio/video/document): allow multiple files per item'),
  options: z.array(optionEntrySchema).optional()
    .describe('For "option" field type: the selectable values'),
  count_collection_id: z.string().optional()
    .describe('For "count" field type: the child collection whose items will be counted'),
  count_field_id: z.string().optional()
    .describe('For "count" field type: the reference field on the child collection that points back here'),
}).describe('Type-specific field configuration');

const sortDirectionEnum = z.enum(['asc', 'desc', 'manual'])
  .describe('"manual" uses the item manual_order; otherwise sorts by the field value');

const sortingSchema = z.object({
  field: z.string().describe('Field ID to sort by, or the literal "manual_order"'),
  direction: sortDirectionEnum,
}).describe('Default sort order for items in this collection');

/**
 * Translate the MCP-facing `data` schema (with flat count_collection_id /
 * count_field_id keys for ergonomics) into the storage shape used by
 * CollectionFieldData.
 */
function buildFieldData(input: z.infer<typeof fieldDataSchema> | undefined): CollectionFieldData | undefined {
  if (!input) return undefined;
  const data: CollectionFieldData = {};
  if (input.multiple !== undefined) data.multiple = input.multiple;
  if (input.options !== undefined) data.options = input.options;
  if (input.count_collection_id && input.count_field_id) {
    data.count = { collectionId: input.count_collection_id, fieldId: input.count_field_id };
  }
  return data;
}

export function registerCollectionTools(server: McpServer) {
  server.tool(
    'list_collections',
    "List all CMS collections with their IDs, names, slugs, and default sorting. Collections are YCode's CMS — each collection is like a database table.",
    {},
    async () => {
      const collections = await getAllCollections();
      return { content: [{ type: 'text' as const, text: JSON.stringify(collections, null, 2) }] };
    },
  );

  server.tool(
    'create_collection',
    'Create a new CMS collection. After creating, use add_collection_field to define its schema.',
    {
      name: z.string().describe('Collection name (e.g. "Blog Posts", "Team Members")'),
      sorting: sortingSchema.optional(),
    },
    async ({ name, sorting }) => {
      const collection = await createCollection({ name, sorting: sorting as CollectionSorting | undefined });
      return { content: [{ type: 'text' as const, text: JSON.stringify(collection, null, 2) }] };
    },
  );

  server.tool(
    'add_collection_field',
    `Add a field to a collection's schema.

FIELD TYPES:
- text, number, boolean, date (datetime), date_only (date without time)
- reference (single link to one item), multi_reference (link to multiple items)
- rich_text, color, status
- image, audio, video, document (use data.multiple: true for multi-asset fields)
- link, email, phone
- option (predefined choices — pass data.options)
- count (computed count of related items — pass data.count_collection_id + data.count_field_id)`,
    {
      collection_id: z.string().describe('The collection ID'),
      name: z.string().describe('Field display name'),
      type: fieldTypeEnum,
      key: z.string().optional().describe('Unique field key (auto-generated from name if omitted)'),
      reference_collection_id: z.string().optional().describe('For reference / multi_reference fields: the target collection ID'),
      default: z.string().optional().describe('Default value applied to new items'),
      fillable: z.boolean().optional().describe('Whether this field can be set via the API / form submissions. Defaults true.'),
      hidden: z.boolean().optional().describe('Hide this field from the CMS UI. Useful for internal computed fields.'),
      is_computed: z.boolean().optional().describe('Whether the value is computed automatically (e.g. count fields).'),
      data: fieldDataSchema.optional(),
    },
    async ({ collection_id, data, ...fieldData }) => {
      const existingFields = await getFieldsByCollectionId(collection_id);
      const order = existingFields.length;
      const field = await createField({
        collection_id,
        order,
        ...fieldData,
        type: fieldData.type as CollectionFieldType,
        data: buildFieldData(data),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(field, null, 2) }] };
    },
  );

  server.tool(
    'list_collection_items',
    'List items in a collection with their field values.',
    {
      collection_id: z.string().describe('The collection ID'),
      search: z.string().optional().describe('Search term to filter items'),
    },
    async ({ collection_id, search }) => {
      const fields = await getFieldsByCollectionId(collection_id);
      const { items, total } = await getItemsByCollectionId(collection_id, false, search ? { search } : undefined);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            fields: fields.map((f) => ({ id: f.id, name: f.name, type: f.type, key: f.key, data: f.data })),
            items,
            total,
          }, null, 2),
        }],
      };
    },
  );

  server.tool(
    'create_collection_item',
    'Create a new item in a collection. Optionally provide field values as { fieldId: value } pairs.',
    {
      collection_id: z.string().describe('The collection ID'),
      values: z.record(z.string(), z.unknown()).optional()
        .describe('Field values as { fieldId: value } pairs. For "option" fields, value is the option ID. For multi-asset fields, value is a JSON array of asset IDs.'),
    },
    async ({ collection_id, values }) => {
      const item = await createItem({ collection_id });

      if (values && Object.keys(values).length > 0) {
        const fields = await getFieldsByCollectionId(collection_id);
        const fieldType: Record<string, CollectionFieldType> = {};
        for (const f of fields) {
          fieldType[f.id] = f.type;
        }
        await setValuesByFieldName(item.id, collection_id, values as Record<string, unknown>, fieldType);
      }

      const { items: itemWithValues } = await getItemsWithValues(collection_id);
      const created = itemWithValues.find((i) => i.id === item.id);

      return { content: [{ type: 'text' as const, text: JSON.stringify(created || item, null, 2) }] };
    },
  );

  server.tool(
    'update_collection_item',
    'Update field values for an existing collection item',
    {
      collection_id: z.string().describe('The collection ID'),
      item_id: z.string().describe('The item ID to update'),
      values: z.record(z.string(), z.unknown()).describe('Field values to update as { fieldId: value } pairs'),
    },
    async ({ collection_id, item_id, values }) => {
      const fields = await getFieldsByCollectionId(collection_id);
      const fieldType: Record<string, CollectionFieldType> = {};
      for (const f of fields) {
        fieldType[f.id] = f.type;
      }
      await setValuesByFieldName(item_id, collection_id, values as Record<string, unknown>, fieldType);
      return { content: [{ type: 'text' as const, text: `Updated item ${item_id}` }] };
    },
  );

  server.tool(
    'delete_collection_item',
    'Delete an item from a collection',
    {
      collection_id: z.string().describe('The collection ID'),
      item_id: z.string().describe('The item ID to delete'),
    },
    async ({ item_id }) => {
      await deleteItem(item_id);
      return { content: [{ type: 'text' as const, text: `Deleted item ${item_id}` }] };
    },
  );

  server.tool(
    'set_collection_item_order',
    'Set the manual ordering position of an item within its collection. Only takes effect when the collection sorting is "manual".',
    {
      collection_id: z.string().describe('The collection ID (for permission scoping)'),
      item_id: z.string().describe('The item ID to reorder'),
      manual_order: z.number().int().describe('New position. Lower values appear first.'),
    },
    async ({ item_id, manual_order }) => {
      const item = await updateItem(item_id, { manual_order });
      return { content: [{ type: 'text' as const, text: JSON.stringify(item, null, 2) }] };
    },
  );

  server.tool(
    'update_collection',
    'Rename a collection or update its default sorting.',
    {
      collection_id: z.string().describe('The collection ID'),
      name: z.string().optional().describe('New collection name'),
      sorting: sortingSchema.nullable().optional()
        .describe('Default sort applied in the CMS list view and on the canvas. Pass null to clear.'),
    },
    async ({ collection_id, name, sorting }) => {
      const updates: { name?: string; sorting?: CollectionSorting | null } = {};
      if (name !== undefined) updates.name = name;
      if (sorting !== undefined) updates.sorting = sorting as CollectionSorting | null;
      const collection = await updateCollection(collection_id, updates);
      return { content: [{ type: 'text' as const, text: JSON.stringify(collection, null, 2) }] };
    },
  );

  server.tool(
    'delete_collection',
    'Delete a collection and all its fields, items, and values',
    { collection_id: z.string().describe('The collection ID to delete') },
    async ({ collection_id }) => {
      await deleteCollection(collection_id);
      return { content: [{ type: 'text' as const, text: `Deleted collection ${collection_id}` }] };
    },
  );

  server.tool(
    'update_collection_field',
    'Update a collection field (rename, change type, update reference, change metadata, update type-specific data).',
    {
      field_id: z.string().describe('The field ID to update'),
      name: z.string().optional().describe('New field name'),
      type: fieldTypeEnum.optional(),
      reference_collection_id: z.string().nullable().optional().describe('For reference fields: target collection ID. Pass null to clear.'),
      default: z.string().nullable().optional().describe('Default value applied to new items. Pass null to clear.'),
      fillable: z.boolean().optional(),
      hidden: z.boolean().optional(),
      data: fieldDataSchema.optional().describe('Replaces the entire field data object. Pass options[] to add/remove option values, data.multiple to toggle multi-asset, etc.'),
    },
    async ({ field_id, data, ...updates }) => {
      const field = await updateField(field_id, {
        ...updates,
        type: updates.type as CollectionFieldType | undefined,
        data: buildFieldData(data),
      });
      return { content: [{ type: 'text' as const, text: JSON.stringify(field, null, 2) }] };
    },
  );

  server.tool(
    'delete_collection_field',
    'Delete a field from a collection. This also removes all values for this field.',
    { field_id: z.string().describe('The field ID to delete') },
    async ({ field_id }) => {
      await deleteField(field_id);
      return { content: [{ type: 'text' as const, text: `Deleted field ${field_id}` }] };
    },
  );

  server.tool(
    'reorder_collection_fields',
    'Reorder the fields of a collection. Pass the field IDs in the desired display order.',
    {
      collection_id: z.string().describe('The collection ID'),
      field_ids: z.array(z.string()).min(1).describe('All field IDs in the desired order'),
    },
    async ({ collection_id, field_ids }) => {
      await reorderFields(collection_id, false, field_ids);
      return { content: [{ type: 'text' as const, text: `Reordered ${field_ids.length} fields in collection ${collection_id}` }] };
    },
  );
}
