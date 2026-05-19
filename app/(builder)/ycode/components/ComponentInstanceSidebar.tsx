'use client';

import React, { useState, useCallback } from 'react';

import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import Icon from '@/components/ui/icon';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import ComponentVariableLabel, { VARIABLE_TYPE_ICONS } from './ComponentVariableLabel';
import ComponentVariableOverrides from './ComponentVariableOverrides';
import ComponentVariablesDialog from './ComponentVariablesDialog';
import RichTextEditor from './RichTextEditor';
import ExpandableRichTextEditor from './ExpandableRichTextEditor';
import SettingsPanel from './SettingsPanel';

import { useEditorStore } from '@/stores/useEditorStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useEditComponent } from '@/hooks/use-edit-component';
import { detachSpecificLayerFromComponent } from '@/lib/component-utils';
import { collectVariantVariableOptions } from '@/lib/component-variant-utils';
import { EMPTY_OVERRIDES } from '@/lib/variable-utils';

import type { Layer, ComponentVariable, Component, Collection, CollectionField } from '@/types';
import { SIMPLE_TEXT_FIELD_TYPES, type FieldGroup } from '@/lib/collection-field-utils';

interface ComponentInstanceSidebarProps {
  selectedLayerId: string;
  selectedLayer: Layer;
  component: Component;
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  allLayers: Layer[];
  fieldGroups: FieldGroup[] | undefined;
  fields: Record<string, CollectionField[]>;
  collections: Collection[];
  isInsideCollectionLayer: boolean;
}

export default function ComponentInstanceSidebar({
  selectedLayerId,
  selectedLayer,
  component,
  onLayerUpdate,
  allLayers,
  fieldGroups,
  fields,
  collections,
  isInsideCollectionLayer,
}: ComponentInstanceSidebarProps) {
  const editComponent = useEditComponent();

  const currentPageId = useEditorStore((state) => state.currentPageId);
  const editingComponentId = useEditorStore((state) => state.editingComponentId);

  const getComponentById = useComponentsStore((state) => state.getComponentById);
  const updateComponentDraft = useComponentsStore((state) => state.updateComponentDraft);
  const addTextVariable = useComponentsStore((state) => state.addTextVariable);
  const addRichTextVariable = useComponentsStore((state) => state.addRichTextVariable);
  const addImageVariable = useComponentsStore((state) => state.addImageVariable);
  const addLinkVariable = useComponentsStore((state) => state.addLinkVariable);
  const addAudioVariable = useComponentsStore((state) => state.addAudioVariable);
  const addVideoVariable = useComponentsStore((state) => state.addVideoVariable);
  const addIconVariable = useComponentsStore((state) => state.addIconVariable);
  const addVariantVariable = useComponentsStore((state) => state.addVariantVariable);
  const updateTextVariable = useComponentsStore((state) => state.updateTextVariable);

  const setDraftLayers = usePagesStore((state) => state.setDraftLayers);
  const pages = usePagesStore((state) => state.pages);
  const allComponents = useComponentsStore((state) => state.components);

  const [variablesOpen, setVariablesOpen] = useState(true);
  const [variablesDialogOpen, setVariablesDialogOpen] = useState(false);
  const [variablesDialogInitialId, setVariablesDialogInitialId] = useState<string | null>(null);

  const openVariablesDialog = useCallback((variableId?: string) => {
    setVariablesDialogInitialId(variableId ?? null);
    setVariablesDialogOpen(true);
  }, []);

  const allVariables = component.variables || [];
  const overrides = selectedLayer.componentOverrides;
  const hasOverrides = ['text', 'rich_text', 'image', 'link', 'audio', 'video', 'icon', 'variant']
    .some(cat => Object.keys(overrides?.[cat as keyof typeof overrides] || {}).length > 0);

  const handleEditMasterComponent = useCallback(async () => {
    await editComponent(component.id, {
      returnToLayerId: selectedLayerId,
      variantId: selectedLayer.componentVariantId,
    });
  }, [editComponent, component.id, selectedLayerId, selectedLayer.componentVariantId]);

  const handleOverridesChange = useCallback((newOverrides: Layer['componentOverrides']) => {
    onLayerUpdate(selectedLayerId, { componentOverrides: newOverrides });
  }, [selectedLayerId, onLayerUpdate]);

  // Parent component data (for nested component variable linking)
  const editingComponent = editingComponentId ? getComponentById(editingComponentId) : undefined;
  const parentVariables = editingComponent?.variables || [];

  const handleLinkOverrideVariable = useCallback((childVariableId: string, parentVariableId: string) => {
    onLayerUpdate(selectedLayerId, {
      componentOverrides: {
        ...overrides,
        variableLinks: { ...(overrides?.variableLinks ?? {}), [childVariableId]: parentVariableId },
      },
    });
  }, [selectedLayerId, onLayerUpdate, overrides]);

  // Variant-variable link is a top-level layer field (componentVariantVariableId)
  // — not a `variableLinks` entry — because variant lives on the layer, not in
  // a child variable. See plan: "linking_storage = new_field".
  const handleLinkVariantVariable = useCallback((parentVariableId: string) => {
    onLayerUpdate(selectedLayerId, { componentVariantVariableId: parentVariableId });
  }, [selectedLayerId, onLayerUpdate]);

  const handleUnlinkVariantVariable = useCallback(() => {
    onLayerUpdate(selectedLayerId, { componentVariantVariableId: undefined });
  }, [selectedLayerId, onLayerUpdate]);

  const handleCreateVariantVariable = useCallback(async () => {
    if (!editingComponentId) return;
    const newId = await addVariantVariable(editingComponentId, 'Variant');
    if (!newId) return;

    // Seed the new variable's default with the layer's currently selected
    // variant so reusing the parent without overriding still renders the same
    // variant the user picked while building the parent.
    const currentVariantId = selectedLayer.componentVariantId
      ?? component.variants?.[0]?.id;
    if (currentVariantId) {
      await updateTextVariable(editingComponentId, newId, { default_value: { variant_id: currentVariantId } });
    }
    handleLinkVariantVariable(newId);
    openVariablesDialog(newId);
  }, [editingComponentId, addVariantVariable, selectedLayer.componentVariantId, component.variants, updateTextVariable, handleLinkVariantVariable, openVariablesDialog]);

  const handleUnlinkOverrideVariable = useCallback((childVariableId: string) => {
    const links = { ...(overrides?.variableLinks ?? {}) };
    delete links[childVariableId];
    onLayerUpdate(selectedLayerId, {
      componentOverrides: { ...overrides, variableLinks: links },
    });
  }, [selectedLayerId, onLayerUpdate, overrides]);

  const addVariableByType: Record<string, (id: string, name: string) => Promise<string | null>> = {
    text: addTextVariable,
    rich_text: addRichTextVariable,
    image: addImageVariable,
    link: addLinkVariable,
    audio: addAudioVariable,
    video: addVideoVariable,
    icon: addIconVariable,
  };

  const handleCreateOverrideVariable = useCallback(async (childVariable: ComponentVariable) => {
    if (!editingComponentId) return;
    const type = childVariable.type || 'text';
    const addFn = addVariableByType[type];
    if (!addFn) return;

    const newId = await addFn(editingComponentId, childVariable.name);
    if (!newId) return;

    const category = type === 'text' ? 'text' : type;
    const currentOverride = overrides?.[category as keyof typeof overrides]?.[childVariable.id];
    const defaultValue = currentOverride ?? childVariable.default_value;
    if (defaultValue) {
      await updateTextVariable(editingComponentId, newId, { default_value: defaultValue });
    }

    handleLinkOverrideVariable(childVariable.id, newId);
    openVariablesDialog(newId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingComponentId, overrides, handleLinkOverrideVariable, openVariablesDialog, updateTextVariable]);

  const handleDetachFromComponent = useCallback(() => {
    if (!selectedLayer.componentId) return;

    const newLayers = detachSpecificLayerFromComponent(allLayers, selectedLayerId, component);

    if (editingComponentId) {
      // Detach happens against whichever variant the user is currently
      // editing — that's what `allLayers` was sourced from upstream.
      const variantId = useEditorStore.getState().editingComponentVariantId;
      const variantDrafts = useComponentsStore.getState().componentDrafts[editingComponentId];
      const targetVariantId = (variantId && variantDrafts?.[variantId]) ? variantId : (variantDrafts ? Object.keys(variantDrafts)[0] : null);
      if (targetVariantId) {
        updateComponentDraft(editingComponentId, targetVariantId, newLayers);
      }
    } else if (currentPageId) {
      setDraftLayers(currentPageId, newLayers);
    }

    useEditorStore.getState().setSelectedLayerId(null);
  }, [selectedLayer.componentId, allLayers, selectedLayerId, component, editingComponentId, currentPageId, updateComponentDraft, setDraftLayers]);

  const handleResetAllOverrides = useCallback(() => {
    onLayerUpdate(selectedLayerId, {
      componentOverrides: { ...EMPTY_OVERRIDES },
    });
  }, [selectedLayerId, onLayerUpdate]);

  return (
    <div className="w-64 shrink-0 bg-background border-l flex flex-col p-4 pb-0 h-full overflow-hidden">
      <Tabs
        value=""
        className="flex flex-col min-h-0 gap-0!"
      >
        <div>
          <TabsList className="w-full">
            <TabsTrigger value="design" disabled>Design</TabsTrigger>
            <TabsTrigger value="settings" disabled>Settings</TabsTrigger>
            <TabsTrigger value="interactions" disabled>Interactions</TabsTrigger>
          </TabsList>
        </div>

        <hr className="mt-4" />

        <div className="flex flex-col divide-y divide-border overflow-y-auto no-scrollbar">
          <SettingsPanel
            title="Component instance"
            isOpen={true}
            onToggle={() => {}}
            action={
              <div className="flex items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="xs"
                      variant="ghost"
                    >
                      <Icon name="more" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={handleResetAllOverrides}
                      disabled={!hasOverrides}
                    >
                      <Icon name="undo" />
                      Reset all overrides
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDetachFromComponent}>
                      <Icon name="detach" />
                      Detach from component
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
          >
            <div className="bg-purple-500/20 text-purple-700 dark:text-purple-300 pl-2 pr-3 h-10 rounded-lg flex items-center gap-2">
              <div className="p-1.5 bg-current/20 rounded-xl">
                <Icon
                  name="component"
                  className="size-3"
                />
              </div>
              <span>{component.name}</span>
              {hasOverrides && (
                <span className="ml-auto text-[10px] italic text-orange-600 dark:text-orange-200">Overridden</span>
              )}
            </div>

            {/* Variant selector. Always rendered when the component has any
                variants so users editing a parent can link this layer's
                variant to a parent variable even if the child only ships with
                one variant today. Variables are shared across variants, so
                changing the variant only switches the layer tree. */}
            {component.variants && component.variants.length > 0 && (() => {
              const linkedParentVariantVar = editingComponent?.variables?.find(
                v => v.id === selectedLayer.componentVariantVariableId && (v.type || 'text') === 'variant'
              );
              const variantParentVariables = parentVariables.filter(v => (v.type || 'text') === 'variant');

              return (
                <div className="grid grid-cols-3 items-center gap-2">
                  <div className="flex items-center gap-1">
                    <ComponentVariableLabel
                      label="Variant"
                      isEditingComponent={!!editingComponentId}
                      variables={variantParentVariables}
                      linkedVariableId={linkedParentVariantVar?.id}
                      onLinkVariable={handleLinkVariantVariable}
                      onManageVariables={() => openVariablesDialog(linkedParentVariantVar?.id)}
                      onCreateVariable={editingComponentId ? handleCreateVariantVariable : undefined}
                    />
                  </div>

                  <div className="col-span-2 *:w-full">
                    {linkedParentVariantVar ? (
                      <Button
                        asChild
                        variant="purple"
                        className="justify-between! w-full"
                        onClick={() => openVariablesDialog(linkedParentVariantVar.id)}
                      >
                        <div>
                          <span className="flex items-center gap-1.5">
                            <Icon
                              name={VARIABLE_TYPE_ICONS['variant']}
                              className="size-3 opacity-60"
                            />
                            {linkedParentVariantVar.name}
                          </span>
                          <Button
                            className="size-4! p-0!"
                            variant="outline"
                            onClick={(e) => { e.stopPropagation(); handleUnlinkVariantVariable(); }}
                          >
                            <Icon name="x" className="size-2" />
                          </Button>
                        </div>
                      </Button>
                    ) : (
                      <Select
                        value={
                          component.variants.some(v => v.id === selectedLayer.componentVariantId)
                            ? selectedLayer.componentVariantId!
                            : component.variants[0].id
                        }
                        onValueChange={(value) => {
                          onLayerUpdate(selectedLayerId, { componentVariantId: value });
                        }}
                        disabled={component.variants.length <= 1}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Variant" />
                        </SelectTrigger>
                        <SelectContent>
                          {component.variants.map((variant) => (
                            <SelectItem key={variant.id} value={variant.id}>
                              {variant.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              );
            })()}

            <Button
              size="sm"
              variant="secondary"
              onClick={handleEditMasterComponent}
            >
              <Icon name="edit" />
              Edit component
            </Button>
          </SettingsPanel>

          <SettingsPanel
            title="Variables"
            isOpen={variablesOpen}
            onToggle={() => setVariablesOpen(!variablesOpen)}
          >
            <ComponentVariableOverrides
              variables={allVariables}
              componentOverrides={overrides}
              onOverridesChange={handleOverridesChange}
              fieldGroups={fieldGroups}
              allFields={fields}
              collections={collections}
              isInsideCollectionLayer={isInsideCollectionLayer}
              isEditingComponent={!!editingComponentId}
              parentVariables={parentVariables}
              onLinkOverrideVariable={handleLinkOverrideVariable}
              onUnlinkOverrideVariable={handleUnlinkOverrideVariable}
              onCreateOverrideVariable={handleCreateOverrideVariable}
              onManageVariables={(varId) => openVariablesDialog(varId)}
              getVariantVariableOptions={(variableId) => collectVariantVariableOptions(component, allComponents, variableId)}
              renderTextOverride={(variable, value, onChange, onClear) =>
                variable.type === 'rich_text' ? (
                  <ExpandableRichTextEditor
                    sheetDescription={`${component.name} override — ${variable.name}`}
                    value={value}
                    onChange={onChange}
                    onClear={onClear}
                    placeholder={variable.placeholder || 'Enter text...'}
                    fieldGroups={fieldGroups}
                    allFields={fields}
                    collections={collections}
                  />
                ) : (
                  <RichTextEditor
                    value={value}
                    onChange={onChange}
                    placeholder={variable.placeholder || 'Enter text...'}
                    fieldGroups={fieldGroups}
                    allFields={fields}
                    collections={collections}
                    withFormatting
                    showFormattingToolbar={false}
                    allowedFieldTypes={SIMPLE_TEXT_FIELD_TYPES}
                  />
                )
              }
            />

            {allVariables.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <Empty>
                  <EmptyMedia variant="icon">
                    <Icon
                      name="component"
                      className="size-3.5"
                    />
                  </EmptyMedia>
                  <EmptyTitle>No variables set</EmptyTitle>
                  <EmptyDescription>
                    Enter component editing mode to add variables.
                  </EmptyDescription>
                  <div>
                    <Button
                      onClick={handleEditMasterComponent}
                      variant="secondary"
                      size="sm"
                    >
                      Edit component
                    </Button>
                  </div>
                </Empty>
              </div>
            )}
          </SettingsPanel>
        </div>
      </Tabs>

      <ComponentVariablesDialog
        open={variablesDialogOpen}
        onOpenChange={(open) => {
          setVariablesDialogOpen(open);
          if (!open) setVariablesDialogInitialId(null);
        }}
        componentId={editingComponentId}
        initialVariableId={variablesDialogInitialId}
      />
    </div>
  );
}
