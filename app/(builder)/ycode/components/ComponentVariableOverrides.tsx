'use client';

/**
 * Shared component for rendering component variable override controls.
 * Used in both the RightSidebar (component instance panel) and
 * RichTextComponentBlock (inline rich-text component).
 */

import React, { useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import { cn } from '@/lib/utils';
import ComponentVariableLabel, { VARIABLE_TYPE_ICONS } from './ComponentVariableLabel';
import ImageSettings from './ImageSettings';
import LinkSettings from './LinkSettings';
import AudioSettings from './AudioSettings';
import VideoSettings from './VideoSettings';
import IconSettings from './IconSettings';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  extractTiptapFromComponentVariable,
  createTextComponentVariableValue,
  tiptapEqual,
  EMPTY_OVERRIDES,
} from '@/lib/variable-utils';
import type {
  ComponentVariable,
  ImageSettingsValue,
  LinkSettingsValue,
  AudioSettingsValue,
  VideoSettingsValue,
  IconSettingsValue,
  VariantSettingsValue,
  Layer,
  CollectionField,
  Collection,
} from '@/types';
import type { FieldGroup } from '@/lib/collection-field-utils';
import type { VariantVariableOption } from '@/lib/component-variant-utils';

type Overrides = Layer['componentOverrides'];

interface ComponentVariableOverridesProps {
  variables: ComponentVariable[];
  componentOverrides: Overrides;
  onOverridesChange: (overrides: Overrides) => void;
  fieldGroups?: FieldGroup[];
  allFields?: Record<string, CollectionField[]>;
  collections?: Collection[];
  isInsideCollectionLayer?: boolean;
  /** Custom renderer for text variable overrides (avoids circular dependency with RichTextEditor). */
  renderTextOverride?: (
    variable: ComponentVariable,
    value: any,
    onChange: (tiptapContent: any) => void,
    onClear: () => void,
  ) => React.ReactNode;
  /** Number of columns for the override layout (default: 1) */
  columns?: 1 | 2;
  /** Whether we're in component edit mode (enables variable linking UI) */
  isEditingComponent?: boolean;
  /** The parent component's variables (for linking nested overrides to parent) */
  parentVariables?: ComponentVariable[];
  /** Called when linking a child override to a parent variable */
  onLinkOverrideVariable?: (childVariableId: string, parentVariableId: string) => void;
  /** Called when unlinking a child override from a parent variable */
  onUnlinkOverrideVariable?: (childVariableId: string) => void;
  /** Called to create a new parent variable from a child variable's current override */
  onCreateOverrideVariable?: (childVariable: ComponentVariable) => void;
  /** Called to open the variables dialog, optionally focused on a specific variable */
  onManageVariables?: (variableId?: string) => void;
  /** Resolves the variant Select options for a given `'variant'` variable. The
   *  caller (which has access to the parent component object) walks the tree
   *  to produce these — see `collectVariantVariableOptions`. Required for the
   *  variant override case to render a Select. */
  getVariantVariableOptions?: (variableId: string) => VariantVariableOption[];
}

export default function ComponentVariableOverrides({
  variables,
  componentOverrides,
  onOverridesChange,
  fieldGroups,
  allFields,
  collections,
  isInsideCollectionLayer,
  renderTextOverride,
  columns = 1,
  isEditingComponent,
  parentVariables,
  onLinkOverrideVariable,
  onUnlinkOverrideVariable,
  onCreateOverrideVariable,
  onManageVariables,
  getVariantVariableOptions,
}: ComponentVariableOverridesProps) {
  const getTextOverrideCategory = useCallback(
    (variableId: string): 'text' | 'rich_text' => {
      const variable = variables.find(v => v.id === variableId);
      return variable?.type === 'rich_text' ? 'rich_text' : 'text';
    },
    [variables],
  );

  const handleTextChange = useCallback(
    (variableId: string, tiptapContent: any) => {
      const category = getTextOverrideCategory(variableId);
      const defaultTiptap = extractTiptapFromComponentVariable(
        variables.find(v => v.id === variableId)?.default_value,
      );
      if (tiptapEqual(tiptapContent, defaultTiptap)) {
        const updated = { ...(componentOverrides?.[category] ?? {}) };
        delete updated[variableId];
        onOverridesChange({ ...EMPTY_OVERRIDES, ...componentOverrides, [category]: updated });
        return;
      }
      const value = createTextComponentVariableValue(tiptapContent);
      onOverridesChange({
        ...EMPTY_OVERRIDES,
        ...componentOverrides,
        [category]: { ...(componentOverrides?.[category] ?? {}), [variableId]: value },
      });
    },
    [componentOverrides, onOverridesChange, getTextOverrideCategory, variables],
  );

  const handleTextClear = useCallback(
    (variableId: string) => {
      const category = getTextOverrideCategory(variableId);
      const updated = { ...(componentOverrides?.[category] ?? {}) };
      delete updated[variableId];
      onOverridesChange({
        ...EMPTY_OVERRIDES,
        ...componentOverrides,
        [category]: updated,
      });
    },
    [componentOverrides, onOverridesChange, getTextOverrideCategory],
  );

  const handleTypedChange = useCallback(
    (category: keyof NonNullable<Overrides>, variableId: string, value: any) => {
      onOverridesChange({
        ...EMPTY_OVERRIDES,
        ...componentOverrides,
        [category]: { ...(componentOverrides?.[category] ?? {}), [variableId]: value },
      });
    },
    [componentOverrides, onOverridesChange],
  );

  const getTextValue = useCallback(
    (variableId: string) => {
      const category = getTextOverrideCategory(variableId);
      const override = componentOverrides?.[category]?.[variableId];
      const def = variables.find(v => v.id === variableId)?.default_value;
      return extractTiptapFromComponentVariable(override ?? def);
    },
    [componentOverrides, variables, getTextOverrideCategory],
  );

  const getTypedValue = useCallback(
    (category: 'image' | 'link' | 'audio' | 'video' | 'icon', variableId: string) => {
      const override = componentOverrides?.[category]?.[variableId];
      const def = variables.find(v => v.id === variableId)?.default_value;
      return override ?? def;
    },
    [componentOverrides, variables],
  );

  /** Get the parent variables filtered to the same type as the child variable. */
  const getMatchingParentVariables = useCallback(
    (childType?: string) => {
      if (!parentVariables?.length) return [];
      const effectiveType = childType || 'text';
      return parentVariables.filter(v => (v.type || 'text') === effectiveType);
    },
    [parentVariables],
  );

  /** Resolve the parent variable for a link, returning undefined if stale or not in edit mode. */
  const getLinkedParentVar = (variableId: string) => {
    if (!isEditingComponent) return undefined;
    const linkedId = componentOverrides?.variableLinks?.[variableId];
    if (!linkedId) return undefined;
    return parentVariables?.find(v => v.id === linkedId);
  };

  if (variables.length === 0) return null;

  const isTwoCol = columns === 2;

  const renderGroup = (items: React.ReactNode[], key: string) => {
    // One column layout, used in the component instance right sidebar
    if (!isTwoCol) {
      return (
        <div
          key={key}
          className="flex flex-col divide-y divide-border [&>div]:py-3 [&>div:first-child]:pt-0 [&>div:last-child]:pb-0"
        >
          {items}
        </div>
      );
    }

    // Two column layout, used in the component variables dialog
    return (
      <div key={key} className="overflow-hidden">
        <div className="-mb-5">
          <div className="columns-2 gap-x-10 [column-rule:1px_solid_var(--color-border)] [column-fill:balance]">
            {items.map((item, i) => (
              <div key={i} className="break-inside-avoid pb-5">{item}</div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderLabel = (variable: ComponentVariable, options?: { centered?: boolean }) => {
    // Single-line controls (e.g. the variant Select) live in `items-center`
    // rows; the default `pt-2` / `py-1` spacing is for multi-line controls
    // (image/text/etc.) that anchor the label to the top of the row.
    const centered = options?.centered ?? false;

    if (!isEditingComponent) {
      return (
        <Label variant="muted" className={cn('truncate', !centered && 'pt-2')}>
          {variable.name}
        </Label>
      );
    }

    const linkedParentVar = getLinkedParentVar(variable.id);

    return (
      <div className={cn('flex gap-1', centered ? 'items-center' : 'items-start py-1')}>
        <ComponentVariableLabel
          label={variable.name}
          isEditingComponent
          variables={getMatchingParentVariables(variable.type)}
          linkedVariableId={linkedParentVar?.id}
          onLinkVariable={(parentVarId) => onLinkOverrideVariable?.(variable.id, parentVarId)}
          onManageVariables={() => onManageVariables?.(linkedParentVar?.id)}
          onCreateVariable={onCreateOverrideVariable
            ? () => onCreateOverrideVariable(variable)
            : undefined}
        />
      </div>
    );
  };

  const renderLinkedBadge = (variable: ComponentVariable) => {
    const parentVar = getLinkedParentVar(variable.id);
    if (!parentVar) return null;

    return (
      <Button
        asChild
        variant="purple"
        className="justify-between! w-full"
        onClick={() => onManageVariables?.(parentVar.id)}
      >
        <div>
          <span className="flex items-center gap-1.5">
            <Icon
              name={VARIABLE_TYPE_ICONS[parentVar.type || 'text']}
              className="size-3 opacity-60"
            />
            {parentVar.name}
          </span>
          <Button
            className="size-4! p-0!"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onUnlinkOverrideVariable?.(variable.id);
            }}
          >
            <Icon name="x" className="size-2" />
          </Button>
        </div>
      </Button>
    );
  };

  const renderItem = (variable: ComponentVariable) => {
    const label = renderLabel(variable);
    const isLinked = !!getLinkedParentVar(variable.id);

    if (isLinked) {
      return (
        <div key={variable.id} className="grid grid-cols-3 gap-2 items-start">
          {label}
          <div className="col-span-2">
            {renderLinkedBadge(variable)}
          </div>
        </div>
      );
    }

    switch (variable.type) {
      case 'image':
        return (
          <div key={variable.id} className="grid grid-cols-3 gap-2 items-start">
            {label}
            <div className="col-span-2">
              <ImageSettings
                mode="standalone"
                value={getTypedValue('image', variable.id) as ImageSettingsValue | undefined}
                onChange={(val) => handleTypedChange('image', variable.id, val)}
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
              />
            </div>
          </div>
        );
      case 'link':
        return (
          <div key={variable.id} className="grid grid-cols-3 gap-2 items-start">
            {label}
            <div className="col-span-2">
              <LinkSettings
                mode="standalone"
                value={getTypedValue('link', variable.id) as LinkSettingsValue | undefined}
                onChange={(val) => handleTypedChange('link', variable.id, val)}
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
                isInsideCollectionLayer={isInsideCollectionLayer}
              />
            </div>
          </div>
        );
      case 'audio':
        return (
          <div key={variable.id} className="grid grid-cols-3 gap-2 items-start">
            {label}
            <div className="col-span-2">
              <AudioSettings
                mode="standalone"
                value={getTypedValue('audio', variable.id) as AudioSettingsValue | undefined}
                onChange={(val) => handleTypedChange('audio', variable.id, val)}
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
              />
            </div>
          </div>
        );
      case 'video':
        return (
          <div key={variable.id} className="grid grid-cols-3 gap-2 items-start">
            {label}
            <div className="col-span-2">
              <VideoSettings
                mode="standalone"
                value={getTypedValue('video', variable.id) as VideoSettingsValue | undefined}
                onChange={(val) => handleTypedChange('video', variable.id, val)}
                fieldGroups={fieldGroups}
                allFields={allFields}
                collections={collections}
              />
            </div>
          </div>
        );
      case 'icon':
        return (
          <div key={variable.id} className="grid grid-cols-3 gap-2 items-start">
            {label}
            <div className="col-span-2">
              <IconSettings
                mode="standalone"
                value={getTypedValue('icon', variable.id) as IconSettingsValue | undefined}
                onChange={(val) => handleTypedChange('icon', variable.id, val)}
              />
            </div>
          </div>
        );
      case 'variant': {
        const options = getVariantVariableOptions?.(variable.id) ?? [];
        const currentValue = getTypedValue('variant' as 'icon', variable.id) as VariantSettingsValue | undefined;
        const componentIds = Array.from(new Set(options.map(o => o.component_id)));
        const showComponentName = componentIds.length > 1;
        const variantLabel = renderLabel(variable, { centered: true });

        return (
          <div key={variable.id} className="grid grid-cols-3 gap-2 items-center">
            {variantLabel}
            <div className="col-span-2 *:w-full">
              {options.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  Link this variable from a nested component.
                </p>
              ) : (
                <Select
                  value={currentValue?.variant_id ?? ''}
                  onValueChange={(val) => handleTypedChange('variant' as 'icon', variable.id, { variant_id: val })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Variant" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((opt) => (
                      <SelectItem key={`${opt.component_id}-${opt.variant_id}`} value={opt.variant_id}>
                        {showComponentName
                          ? `${opt.component_name} · ${opt.variant_name}`
                          : opt.variant_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        );
      }
      case 'rich_text':
      default:
        return (
          <div key={variable.id} className="grid grid-cols-3 gap-2 items-start">
            {label}
            <div className="col-span-2 min-w-0 *:w-full">
              {renderTextOverride
                ? renderTextOverride(
                  variable,
                  getTextValue(variable.id),
                  (val) => handleTextChange(variable.id, val),
                  () => handleTextClear(variable.id),
                )
                : null}
            </div>
          </div>
        );
    }
  };

  const allItems = variables.map(renderItem);

  return renderGroup(allItems, 'all');
}
