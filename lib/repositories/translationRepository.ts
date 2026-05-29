/**
 * Translation Repository
 *
 * Data access layer for translations
 * Supports draft/published workflow with composite primary key (id, is_published)
 */

import { getSupabaseAdmin } from '@/lib/supabase-server';
import { fetchAllRows } from '@/lib/supabase-constants';
import type { Translation, CreateTranslationData, UpdateTranslationData } from '@/types';

type TranslationDiffRow = Pick<
  Translation,
  'id' | 'content_value' | 'is_completed' | 'deleted_at'
>;

/**
 * Get all translations for a locale (draft by default). Pages through the
 * 1000-row PostgREST default so projects with large catalogues don't get
 * silently truncated.
 */
export async function getTranslationsByLocale(
  localeId: string,
  isPublished: boolean = false
): Promise<Translation[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const PAGE_SIZE = 1000;
  const results: Translation[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('translations')
      .select('*')
      .eq('locale_id', localeId)
      .eq('is_published', isPublished)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch translations: ${error.message}`);
    }

    if (!data || data.length === 0) break;
    results.push(...(data as Translation[]));
    if (data.length < PAGE_SIZE) break;
  }

  return results;
}

/**
 * Get translations by source (draft by default)
 */
export async function getTranslationsBySource(
  sourceType: string,
  sourceId: string,
  isPublished: boolean = false
): Promise<Translation[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .select('*')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch translations: ${error.message}`);
  }

  return data || [];
}

/**
 * Get a single translation by ID (draft by default)
 */
export async function getTranslationById(
  id: string,
  isPublished: boolean = false
): Promise<Translation | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .select('*')
    .eq('id', id)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch translation: ${error.message}`);
  }

  return data;
}

/**
 * Get a translation by locale and key parts (draft by default)
 */
export async function getTranslationByKey(
  localeId: string,
  sourceType: string,
  sourceId: string,
  contentKey: string,
  isPublished: boolean = false
): Promise<Translation | null> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .select('*')
    .eq('locale_id', localeId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('content_key', contentKey)
    .eq('is_published', isPublished)
    .is('deleted_at', null)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // Not found
    }
    throw new Error(`Failed to fetch translation: ${error.message}`);
  }

  return data;
}

/**
 * Create a new translation (draft by default)
 * Uses upsert to handle existing translations
 */
export async function createTranslation(
  translationData: CreateTranslationData
): Promise<Translation> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .upsert(
      {
        locale_id: translationData.locale_id,
        source_type: translationData.source_type,
        source_id: translationData.source_id,
        content_key: translationData.content_key,
        content_type: translationData.content_type,
        content_value: translationData.content_value,
        is_completed: translationData.is_completed ?? false,
        is_published: false,
        deleted_at: null, // Restore if previously deleted
      },
      {
        onConflict: 'locale_id,source_type,source_id,content_key,is_published',
      }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create translation: ${error.message}`);
  }

  return data;
}

/**
 * Update a translation (draft only)
 */
export async function updateTranslation(
  id: string,
  updates: UpdateTranslationData
): Promise<Translation> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await client
    .from('translations')
    .update({
      ...updates,
      deleted_at: null, // Restore if previously deleted
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('is_published', false)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update translation: ${error.message}`);
  }

  return data;
}

/**
 * Delete a translation (soft delete - sets deleted_at timestamp)
 */
export async function deleteTranslation(id: string): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const { error } = await client
    .from('translations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('is_published', false);

  if (error) {
    throw new Error(`Failed to delete translation: ${error.message}`);
  }
}

/**
 * Delete translations in bulk (soft delete - sets deleted_at timestamp)
 * Only deletes draft versions
 *
 * @param sourceType - Type of source (page, folder, component, cms)
 * @param sourceIds - Single source ID or array of source IDs
 * @param contentKeys - Optional. Specific content keys to delete. If not provided, deletes all translations for the source(s).
 */
export async function deleteTranslationsInBulk(
  sourceType: string,
  sourceIds: string | string[],
  contentKeys?: string[]
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  // Normalize sourceIds to array
  const sourceIdArray = Array.isArray(sourceIds) ? sourceIds : [sourceIds];

  // If no source IDs, nothing to delete
  if (sourceIdArray.length === 0) {
    return;
  }

  // If contentKeys provided but empty, nothing to delete
  if (contentKeys !== undefined && contentKeys.length === 0) {
    return;
  }

  // Build the base query
  let query = client
    .from('translations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('source_type', sourceType)
    .in('source_id', sourceIdArray)
    .eq('is_published', false);

  // Add content_key filter if specific keys provided
  if (contentKeys !== undefined) {
    query = query.in('content_key', contentKeys);
  }

  const { error } = await query;

  if (error) {
    throw new Error(`Failed to delete translations: ${error.message}`);
  }
}

/**
 * Mark translations as incomplete when source content changes
 */
export async function markTranslationsIncomplete(
  sourceType: string,
  sourceId: string,
  contentKeys: string[]
): Promise<void> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  if (contentKeys.length === 0) {
    return; // Nothing to update
  }

  const { error } = await client
    .from('translations')
    .update({
      is_completed: false,
      updated_at: new Date().toISOString(),
    })
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .in('content_key', contentKeys)
    .eq('is_published', false)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to mark translations as incomplete: ${error.message}`);
  }
}

/**
 * Upsert multiple translations (draft by default)
 * Uses batch upsert for efficiency
 */
export async function upsertTranslations(
  translations: CreateTranslationData[]
): Promise<Translation[]> {
  const client = await getSupabaseAdmin();

  if (!client) {
    throw new Error('Supabase not configured');
  }

  const translationsToUpsert = translations.map((t) => ({
    locale_id: t.locale_id,
    source_type: t.source_type,
    source_id: t.source_id,
    content_key: t.content_key,
    content_type: t.content_type,
    content_value: t.content_value,
    // Without this, the DB default (false) keeps batch translations hidden on
    // the live site, which only renders completed translations.
    is_completed: t.is_completed ?? false,
    is_published: false,
    deleted_at: null, // Restore if previously deleted
  }));

  const { data, error } = await client
    .from('translations')
    .upsert(translationsToUpsert, {
      onConflict: 'locale_id,source_type,source_id,content_key,is_published',
    })
    .select();

  if (error) {
    throw new Error(`Failed to upsert translations: ${error.message}`);
  }

  return data || [];
}

/**
 * Count translations needing publish: drafts with no published counterpart,
 * pending soft-deletes, or rows whose content_value/is_completed differs from
 * published. Mirrors the diff logic in `publishLocalisation` so the preview
 * matches what will actually publish. Paginates both sides to avoid the
 * 1000-row PostgREST default silently truncating the count.
 */
export async function getUnpublishedTranslationsCount(): Promise<number> {
  const client = await getSupabaseAdmin();

  if (!client) {
    return 0;
  }

  const cols = 'id, content_value, is_completed, deleted_at';

  // Order by id so .range() pagination is deterministic — without an ORDER BY
  // PostgREST returns rows in arbitrary order between pages, which causes
  // duplicates and gaps when paging tens of thousands of translations, leading
  // to spurious "missing in published map" hits and inflated change counts.
  const [draftRows, publishedRows] = await Promise.all([
    fetchAllRows<TranslationDiffRow>((from, to) =>
      client.from('translations').select(cols).eq('is_published', false).order('id', { ascending: true }).range(from, to)
    ),
    fetchAllRows<TranslationDiffRow>((from, to) =>
      client.from('translations').select(cols).eq('is_published', true).order('id', { ascending: true }).range(from, to)
    ),
  ]);

  if (draftRows.length === 0) {
    return 0;
  }

  const publishedById = new Map<string, TranslationDiffRow>();
  for (const t of publishedRows) {
    publishedById.set(t.id, t);
  }

  let count = 0;
  for (const draft of draftRows) {
    const pub = publishedById.get(draft.id);

    if (!pub || pub.deleted_at) {
      if (!draft.deleted_at) count++;
      continue;
    }

    if (draft.deleted_at) {
      count++;
      continue;
    }

    if (
      draft.content_value !== pub.content_value ||
      draft.is_completed !== pub.is_completed
    ) {
      count++;
    }
  }

  return count;
}
