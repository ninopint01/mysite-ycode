import { Knex } from 'knex';

/**
 * Migration: Add variants column to components table
 *
 * Component variants let a single component have multiple named layer trees
 * (e.g. "Default", "Small", "Large") that share the same component-level
 * variables. The new `variants` jsonb column stores those trees; the existing
 * `layers` column is kept in sync with `variants[0].layers` so any reader that
 * has not been migrated to `variants` still works.
 *
 * Idempotent: safe to run multiple times and on freshly-applied template data.
 */
export async function up(knex: Knex): Promise<void> {
  // 1. Add the column if it does not already exist.
  await knex.raw(`
    ALTER TABLE components
    ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb;
  `);

  // 2. Backfill rows where variants is still empty by wrapping `layers` into a
  //    single "Default" variant. Skips rows that already have variants so it
  //    is safe to run again or against partially-migrated template data.
  await knex.raw(`
    UPDATE components
    SET variants = jsonb_build_array(
      jsonb_build_object(
        'id', gen_random_uuid()::text,
        'name', 'Default',
        'layers', COALESCE(layers, '[]'::jsonb)
      )
    )
    WHERE variants IS NULL OR variants = '[]'::jsonb;
  `);
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('components', 'variants');
  if (hasColumn) {
    await knex.schema.alterTable('components', (table) => {
      table.dropColumn('variants');
    });
  }
}
