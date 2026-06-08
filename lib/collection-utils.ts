import type { Collection, CollectionFieldType, CollectionSorting, Layer } from '@/types';
import { sanitizeSlug } from './page-utils';

/**
 * Collection Utilities
 *
 * Helper functions for working with EAV (Entity-Attribute-Value) collections.
 * Handles value type casting between text storage and typed values.
 */

/**
 * Normalize a boolean value to string 'true' or 'false'
 * Handles various input types: boolean, string, number
 */
export function normalizeBooleanValue(value: any): string {
  const numVal = Number(value);
  return (value === 'true' || value === 'yes' || value === '1' || numVal === 1 || (typeof value === 'boolean' && value)) 
    ? 'true' 
    : 'false';
}

/**
 * Check if a value represents a truthy boolean
 * Handles various input types: boolean, string, number
 */
export function isTruthyBooleanValue(value: any): boolean {
  const numVal = Number(value);
  return value === 'true' || value === 'yes' || value === '1' || numVal === 1;
}

/**
 * Parse a multi-reference field value into an array of IDs
 * Handles both array (from castValue) and JSON string formats
 * @param value - The value which could be an array, JSON string, or undefined
 * @returns Array of string IDs
 */
export function parseMultiReferenceValue(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Sort collections by order field
 * If two collections have the same order, sort by name alphabetically
 * If two collections have the same order and name, sort by created_at time
 * @param collections - Array of collections to sort
 * @returns Sorted array of collections
 */
/** Extract sortBy/sortOrder API params from a collection's sorting config. */
export function getSortParams(sorting: CollectionSorting | null | undefined): { sortBy?: string; sortOrder?: string } {
  if (!sorting || sorting.direction === 'manual') {
    return { sortBy: 'manual', sortOrder: undefined };
  }
  return { sortBy: sorting.field, sortOrder: sorting.direction };
}

export function sortCollectionsByOrder(collections: Collection[]): Collection[] {
  return [...collections].sort((a, b) => {
    // If orders are different, sort by order
    if (a.order !== b.order) {
      return a.order - b.order;
    }

    // If orders are the same, sort by name
    const nameComparison = a.name.localeCompare(b.name);
    if (nameComparison !== 0) {
      return nameComparison;
    }

    // If names are also the same, sort by created_at (oldest first)
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}

/**
 * Cast a text value to its proper type based on field type
 * @param value - The text value from database
 * @param type - The field type to cast to
 * @returns The value cast to the appropriate type
 */
export function castValue(value: string | null, type: CollectionFieldType): any {
  if (value === null || value === undefined || value === '') return null;

  switch (type) {
    case 'number': {
      const num = parseFloat(value);
      return isNaN(num) ? null : num;
    }

    case 'boolean':
      return value === 'true' || value === '1' || value === 'yes';

    case 'date':
    case 'date_only':
      return value;

    case 'reference':
      // Return as string (UUID of referenced item)
      return value;

    case 'rich_text':
      // Parse TipTap JSON from stored string
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }

    case 'link':
      // Keep as raw JSON string — parsed downstream by parseCollectionLinkValue
      return value;

    case 'color':
      // Standard hex color string (e.g. #ff0000 or #ff0000aa with alpha)
      return value;

    case 'email':
    case 'phone':
    case 'text':
    default:
      // Try to parse JSON for text fields that might contain JSON objects
      if (value.startsWith('{') || value.startsWith('[')) {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
  }
}

/**
 * Convert a typed value to string for storage
 * @param value - The typed value
 * @param type - The field type
 * @returns String representation for database storage
 */
export function valueToString(value: any, type: CollectionFieldType): string | null {
  if (value === null || value === undefined) return null;

  // Always JSON.stringify objects to prevent [object Object]
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  switch (type) {
    case 'boolean':
      // Handle both boolean and string values
      if (typeof value === 'string') {
        return (value === 'true' || value === '1' || value === 'yes') ? 'true' : 'false';
      }
      return value ? 'true' : 'false';

    case 'number':
      return String(value);

    case 'date':
    case 'date_only':
      if (value instanceof Date) {
        return value.toISOString();
      }
      return String(value);

    case 'reference':
      // Store ID as string
      return String(value);

    case 'link':
      // Store link settings as JSON
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);

    case 'color':
      // Standard hex color (e.g. #ff0000 or #ff0000aa)
      return String(value);

    case 'email':
    case 'phone':
    case 'rich_text':
    case 'text':
    default:
      return String(value);
  }
}

/**
 * Generate a slug from a name with international character support
 * Uses the same transliteration logic as page slugs
 * @param name - The name to slugify
 * @returns URL-safe slug with transliterated characters
 *
 * @example
 * slugify('Apie mus') // 'apie-mus'
 * slugify('О нас') // 'o-nas'
 * slugify('Über uns') // 'ueber-uns'
 */
export function slugify(name: string): string {
  return sanitizeSlug(name);
}

/**
 * Validate field name format (lowercase, alphanumeric, underscores)
 * @param fieldName - The field name to validate
 * @returns True if valid
 */
export function isValidFieldName(fieldName: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(fieldName);
}

/**
 * Validate collection name format (lowercase, alphanumeric, hyphens)
 * @param collectionName - The collection name to validate
 * @returns True if valid
 */
export function isValidCollectionName(collectionName: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(collectionName);
}

/**
 * Inverse reference field descriptor for UI and data resolution
 */
export interface InverseReferenceField {
  field: import('@/types').CollectionField;
  collection: import('@/types').Collection;
}

/**
 * Find fields in other collections that reference a given collection (inverse references).
 * E.g., if "Books" has a reference field "author" pointing to "Authors",
 * calling this with the Authors collection ID returns the "author" field from Books.
 */
export function getInverseReferenceFields(
  targetCollectionId: string,
  allFields: Record<string, import('@/types').CollectionField[]>,
  allCollections: import('@/types').Collection[]
): InverseReferenceField[] {
  const result: InverseReferenceField[] = [];
  const collectionsMap = new Map(allCollections.map(c => [c.id, c]));

  for (const [collectionId, fields] of Object.entries(allFields)) {
    if (collectionId === targetCollectionId) continue;
    const collection = collectionsMap.get(collectionId);
    if (!collection) continue;

    for (const field of fields) {
      if (
        (field.type === 'reference' || field.type === 'multi_reference') &&
        field.reference_collection_id === targetCollectionId
      ) {
        result.push({ field, collection });
      }
    }
  }

  return result;
}

/**
 * Resolve reference fields synchronously using pre-loaded store data
 * Adds resolved relationship paths (e.g., "refFieldId.targetFieldId") to item values
 * @param itemValues - The item's field values
 * @param fields - The collection's field definitions
 * @param allItems - Map of collection_id → items (from collections store)
 * @param allFields - Map of collection_id → fields (from collections store)
 * @returns Enhanced values with resolved reference paths
 */
export function resolveReferenceFieldsSync(
  itemValues: Record<string, string>,
  fields: import('@/types').CollectionField[],
  allItems: Record<string, import('@/types').CollectionItemWithValues[]>,
  allFields: Record<string, import('@/types').CollectionField[]>,
  visited: Set<string> = new Set(),
  translateValues?: (itemId: string, values: Record<string, string>, fields: import('@/types').CollectionField[]) => Record<string, string>
): Record<string, string> {
  const enhancedValues = { ...itemValues };

  // Find reference fields (single reference only)
  const referenceFields = fields.filter(
    f => f.type === 'reference' && f.reference_collection_id
  );

  for (const field of referenceFields) {
    const refItemId = itemValues[field.id];
    if (!refItemId || !field.reference_collection_id) continue;

    // Prevent infinite loops
    const visitKey = `${field.id}:${refItemId}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    // Find the referenced item in the store
    const refCollectionItems = allItems[field.reference_collection_id] || [];
    const refItem = refCollectionItems.find(item => item.id === refItemId);
    if (!refItem) continue;

    // Get fields for the referenced collection
    const refFields = allFields[field.reference_collection_id] || [];

    // Translate the referenced item's values so the canvas renders referenced
    // CMS content in the active locale (matches the server-side page fetcher)
    const refValues = translateValues
      ? translateValues(refItem.id, refItem.values, refFields)
      : refItem.values;

    // Add referenced item's values with field.id as prefix
    for (const refField of refFields) {
      const refValue = refValues[refField.id];
      if (refValue !== undefined) {
        enhancedValues[`${field.id}.${refField.id}`] = refValue;
      }
    }

    // Recursively resolve nested reference fields
    const nestedValues = resolveReferenceFieldsSync(
      refValues,
      refFields,
      allItems,
      allFields,
      visited,
      translateValues
    );

    // Merge nested values with proper path prefix
    for (const [key, value] of Object.entries(nestedValues)) {
      // Only add paths that were newly resolved (contain dots from nested refs)
      if (key.includes('.')) {
        enhancedValues[`${field.id}.${key}`] = value;
      }
    }
  }

  return enhancedValues;
}

/**
 * Recursively suffix all layer IDs (and matching interaction tween `layer_id`
 * references) in a subtree so each rendered collection item has unique DOM
 * targets. Lets animations bind to the correct element per item instead of
 * sharing one DOM node.
 */
export function remapLayerIdsForCollectionItem(layer: Layer, suffix: string): Layer {
  const originalIds = new Set<string>();
  const collectIds = (l: Layer) => {
    originalIds.add(l.id);
    l.children?.forEach(collectIds);
  };
  collectIds(layer);

  const remapLayer = (l: Layer): Layer => {
    const remapped: Layer = {
      ...l,
      id: `${l.id}${suffix}`,
    };

    if (l.interactions?.length) {
      remapped.interactions = l.interactions.map(interaction => ({
        ...interaction,
        id: `${interaction.id}${suffix}`,
        tweens: interaction.tweens.map(tween => ({
          ...tween,
          layer_id: originalIds.has(tween.layer_id)
            ? `${tween.layer_id}${suffix}`
            : tween.layer_id,
        })),
      }));
    }

    if (l.children) {
      remapped.children = l.children.map(remapLayer);
    }

    return remapped;
  };

  return remapLayer(layer);
}
