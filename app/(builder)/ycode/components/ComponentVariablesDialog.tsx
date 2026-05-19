'use client';

/**
 * Component Variables Dialog
 *
 * Dialog for managing text variables in a component
 * Used when editing components to expose text content as variables
 */

import React, { useState, useEffect } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Icon from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import RichTextEditor from './RichTextEditor';
import ExpandableRichTextEditor from './ExpandableRichTextEditor';
import ImageSettings, { type ImageSettingsValue } from './ImageSettings';
import LinkSettings, { type LinkSettingsValue } from './LinkSettings';
import AudioSettings, { type AudioSettingsValue } from './AudioSettings';
import VideoSettings, { type VideoSettingsValue } from './VideoSettings';
import IconSettings, { type IconSettingsValue } from './IconSettings';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { useComponentsStore } from '@/stores/useComponentsStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { createTextComponentVariableValue, extractTiptapFromComponentVariable } from '@/lib/variable-utils';
import { collectVariantVariableOptions } from '@/lib/component-variant-utils';
import { VARIABLE_TYPE_ICONS } from './ComponentVariableLabel';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { ComponentVariable, VariantSettingsValue } from '@/types';

/** Sortable variable item in the sidebar list. */
function SortableVariableItem({
  variable,
  isSelected,
  onSelect,
  onDelete,
}: {
  variable: ComponentVariable;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({
    id: variable.id,
    animateLayoutChanges: () => false,
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    zIndex: isDragging ? 10 : undefined,
  };

  const iconName = (variable.type && VARIABLE_TYPE_ICONS[variable.type]) || 'text';

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
    >
      <Button
        variant={isSelected ? 'secondary' : 'ghost'}
        className="w-full justify-start group"
        onClick={onSelect}
      >
        <Icon name={iconName} className="size-3 shrink-0" />
        <span className="truncate flex-1 text-left">{variable.name}</span>
        <span
          role="button"
          tabIndex={-1}
          className={cn(
            'ml-auto text-muted-foreground/50 hover:text-muted-foreground',
            isSelected ? '' : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label={`Delete ${variable.name}`}
        >
          <Icon name="x" className="size-3.5" />
        </span>
      </Button>
    </div>
  );
}

interface ComponentVariablesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  componentId: string | null;
  initialVariableId?: string | null;
}

export default function ComponentVariablesDialog({
  open,
  onOpenChange,
  componentId,
  initialVariableId,
}: ComponentVariablesDialogProps) {
  const getComponentById = useComponentsStore((state) => state.getComponentById);
  const addTextVariable = useComponentsStore((state) => state.addTextVariable);
  const addRichTextVariable = useComponentsStore((state) => state.addRichTextVariable);
  const addImageVariable = useComponentsStore((state) => state.addImageVariable);
  const addLinkVariable = useComponentsStore((state) => state.addLinkVariable);
  const addAudioVariable = useComponentsStore((state) => state.addAudioVariable);
  const addVideoVariable = useComponentsStore((state) => state.addVideoVariable);
  const addIconVariable = useComponentsStore((state) => state.addIconVariable);
  const addVariantVariable = useComponentsStore((state) => state.addVariantVariable);
  const updateTextVariable = useComponentsStore((state) => state.updateTextVariable);
  const reorderVariables = useComponentsStore((state) => state.reorderVariables);
  const deleteTextVariable = useComponentsStore((state) => state.deleteTextVariable);
  const allComponents = useComponentsStore((state) => state.components);
  const fields = useCollectionsStore((state) => state.fields);
  const collections = useCollectionsStore((state) => state.collections);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const [selectedVariableId, setSelectedVariableId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingPlaceholder, setEditingPlaceholder] = useState('');
  const [editingDefaultValue, setEditingDefaultValue] = useState<any>(null);

  // Get component and its variables
  const component = componentId ? getComponentById(componentId) : undefined;
  const textVariables = component?.variables || [];

  // Get the currently selected variable
  const selectedVariable = textVariables.find((v) => v.id === selectedVariableId);

  // Helper to get empty Tiptap doc
  const getEmptyTiptapDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      const target = initialVariableId
        ? textVariables.find((v) => v.id === initialVariableId)
        : null;

      if (target) {
        setSelectedVariableId(target.id);
        setEditingName(target.name);
        setEditingPlaceholder(target.placeholder || '');
        setEditingDefaultValue(extractTiptapFromComponentVariable(target.default_value));
      } else if (textVariables.length > 0) {
        setSelectedVariableId(textVariables[0].id);
        setEditingName(textVariables[0].name);
        setEditingPlaceholder(textVariables[0].placeholder || '');
        setEditingDefaultValue(extractTiptapFromComponentVariable(textVariables[0].default_value));
      } else {
        setSelectedVariableId(null);
        setEditingName('');
        setEditingPlaceholder('');
        setEditingDefaultValue(getEmptyTiptapDoc());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, componentId]);

  // Update editing values when selection changes
  useEffect(() => {
    if (selectedVariable) {
      setEditingName(selectedVariable.name);
      setEditingPlaceholder(selectedVariable.placeholder || '');
      setEditingDefaultValue(extractTiptapFromComponentVariable(selectedVariable.default_value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVariableId]);

  const handleAddTextVariable = async () => {
    if (!componentId) return;

    const newId = await addTextVariable(componentId, 'Text');
    if (newId) {
      setSelectedVariableId(newId);
      setEditingName('Text');
    }
  };

  const handleAddRichTextVariable = async () => {
    if (!componentId) return;

    const newId = await addRichTextVariable(componentId, 'Rich text');
    if (newId) {
      setSelectedVariableId(newId);
      setEditingName('Rich text');
    }
  };

  // Handle creating a new image variable
  const handleAddImageVariable = async () => {
    if (!componentId) return;

    const newId = await addImageVariable(componentId, 'Image');
    if (newId) {
      setSelectedVariableId(newId);
      setEditingName('Image');
    }
  };

  // Handle creating a new link variable
  const handleAddLinkVariable = async () => {
    if (!componentId) return;

    const newId = await addLinkVariable(componentId, 'Link');
    if (newId) {
      setSelectedVariableId(newId);
      setEditingName('Link');
    }
  };

  // Handle creating a new audio variable
  const handleAddAudioVariable = async () => {
    if (!componentId) return;

    const newId = await addAudioVariable(componentId, 'Audio');
    if (newId) {
      setSelectedVariableId(newId);
      setEditingName('Audio');
    }
  };

  // Handle creating a new video variable
  const handleAddVideoVariable = async () => {
    if (!componentId) return;

    const newId = await addVideoVariable(componentId, 'Video');
    if (newId) {
      setSelectedVariableId(newId);
      setEditingName('Video');
    }
  };

  // Handle creating a new icon variable
  const handleAddIconVariable = async () => {
    if (!componentId) return;

    const newId = await addIconVariable(componentId, 'Icon');
    if (newId) {
      setSelectedVariableId(newId);
      setEditingName('Icon');
    }
  };

  const handleAddVariantVariable = async () => {
    if (!componentId) return;

    const newId = await addVariantVariable(componentId, 'Variant');
    if (newId) {
      setSelectedVariableId(newId);
      setEditingName('Variant');
    }
  };

  const handleVariantDefaultValueChange = (variantId: string) => {
    if (!componentId || !selectedVariableId) return;
    const value: VariantSettingsValue = { variant_id: variantId };
    updateTextVariable(componentId, selectedVariableId, { default_value: value });
  };

  // Handle image default value change (via ImageSettings standalone mode)
  const handleImageDefaultValueChange = (value: ImageSettingsValue) => {
    if (!componentId || !selectedVariableId) return;
    updateTextVariable(componentId, selectedVariableId, { default_value: value });
  };

  // Handle link default value change (via LinkSettings standalone mode)
  const handleLinkDefaultValueChange = (value: LinkSettingsValue) => {
    if (!componentId || !selectedVariableId) return;
    updateTextVariable(componentId, selectedVariableId, { default_value: value });
  };

  const handleAudioDefaultValueChange = (value: AudioSettingsValue) => {
    if (!componentId || !selectedVariableId) return;
    updateTextVariable(componentId, selectedVariableId, { default_value: value });
  };

  const handleVideoDefaultValueChange = (value: VideoSettingsValue) => {
    if (!componentId || !selectedVariableId) return;
    updateTextVariable(componentId, selectedVariableId, { default_value: value });
  };

  const handleIconDefaultValueChange = (value: IconSettingsValue) => {
    if (!componentId || !selectedVariableId) return;
    updateTextVariable(componentId, selectedVariableId, { default_value: value });
  };

  // Handle updating variable name (debounced)
  const handleNameChange = (value: string) => {
    setEditingName(value);
  };

  // Save name on blur
  const handleNameBlur = async () => {
    if (!componentId || !selectedVariableId || !editingName.trim()) return;
    if (selectedVariable && selectedVariable.name !== editingName.trim()) {
      await updateTextVariable(componentId, selectedVariableId, { name: editingName.trim() });
    }
  };

  // Save placeholder on blur
  const handlePlaceholderBlur = async () => {
    if (!componentId || !selectedVariableId) return;
    const trimmed = editingPlaceholder.trim();
    if (selectedVariable && (selectedVariable.placeholder || '') !== trimmed) {
      await updateTextVariable(componentId, selectedVariableId, { placeholder: trimmed || undefined });
    }
  };

  // Handle updating default value (local state only)
  const handleDefaultValueChange = (tiptapContent: any) => {
    setEditingDefaultValue(tiptapContent);
  };

  // Save default value on blur
  const handleDefaultValueBlur = async (tiptapContent: any) => {
    if (!componentId || !selectedVariableId) return;

    // Check if value has changed
    const currentValue = selectedVariable?.default_value;
    const currentTiptap = extractTiptapFromComponentVariable(currentValue);

    // Simple comparison - stringify and compare
    if (JSON.stringify(currentTiptap) === JSON.stringify(tiptapContent)) {
      return; // No change, skip API call
    }

    // Wrap Tiptap content in proper ComponentVariableValue structure (text variable)
    const variableValue = createTextComponentVariableValue(tiptapContent);
    await updateTextVariable(componentId, selectedVariableId, { default_value: variableValue });
  };

  // Handle deleting a variable
  const handleDeleteVariable = async (variableId: string) => {
    if (!componentId) return;
    await deleteTextVariable(componentId, variableId);

    // Select another variable or clear selection
    const remaining = textVariables.filter((v) => v.id !== variableId);
    if (remaining.length > 0) {
      setSelectedVariableId(remaining[0].id);
      setEditingName(remaining[0].name);
    } else {
      setSelectedVariableId(null);
      setEditingName('');
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!componentId || !over || active.id === over.id) return;

    const ids = textVariables.map(v => v.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(ids, oldIndex, newIndex);
    reorderVariables(componentId, reordered);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-xl h-[85vh] max-h-160"
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Component Variables</DialogTitle>
        <div className="flex h-full min-h-0">
          {/* Left sidebar - variable list */}
          <div className="w-60 border-r border-border flex min-h-0 flex-col px-5">
            <header className="flex shrink-0 justify-between py-5">
              <span className="font-medium">Component variables</span>
              <div className="-my-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="xs" variant="secondary">
                      <Icon name="plus" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleAddTextVariable}>
                      <Icon name="text" className="size-3" />
                      Text
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddRichTextVariable}>
                      <Icon name="rich-text" className="size-3" />
                      Rich text
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddLinkVariable}>
                      <Icon name="link" className="size-3" />
                      Link
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddIconVariable}>
                      <Icon name="icon" className="size-3" />
                      Icon
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddImageVariable}>
                      <Icon name="image" className="size-3" />
                      Image
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddAudioVariable}>
                      <Icon name="audio" className="size-3" />
                      Audio
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddVideoVariable}>
                      <Icon name="video" className="size-3" />
                      Video
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleAddVariantVariable}>
                      <Icon name={VARIABLE_TYPE_ICONS['variant']} className="size-3" />
                      Variant
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>

            {/* Variable list */}
            <div className="noscrollbar min-h-0 flex-1 overflow-y-auto">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={textVariables.map(v => v.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {textVariables.map((variable) => (
                    <SortableVariableItem
                      key={variable.id}
                      variable={variable}
                      isSelected={selectedVariableId === variable.id}
                      onSelect={() => setSelectedVariableId(variable.id)}
                      onDelete={() => handleDeleteVariable(variable.id)}
                    />
                  ))}
                </SortableContext>
              </DndContext>

              {textVariables.length === 0 && (
                <p className="py-2 text-xs text-muted-foreground">
                  No variables yet. Click + to add one.
                </p>
              )}
            </div>
          </div>

          {/* Right panel - variable editor */}
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6 pt-14">
            {selectedVariable ? (
              <>
                <div className="grid grid-cols-3">
                  <Label variant="muted">Name</Label>
                  <div className="col-span-2 *:w-full">
                    <Input
                      type="text"
                      placeholder="Variable name"
                      value={editingName}
                      onChange={(e) => handleNameChange(e.target.value)}
                      onBlur={handleNameBlur}
                    />
                  </div>
                </div>

                {(!selectedVariable.type || selectedVariable.type === 'text' || selectedVariable.type === 'rich_text') && (
                  <div className="grid grid-cols-3">
                    <Label variant="muted">Placeholder</Label>
                    <div className="col-span-2 *:w-full">
                      <Input
                        type="text"
                        placeholder="Enter text..."
                        value={editingPlaceholder}
                        onChange={(e) => setEditingPlaceholder(e.target.value)}
                        onBlur={handlePlaceholderBlur}
                      />
                    </div>
                  </div>
                )}

                <Separator className="my-0.5" />

                <div className="grid grid-cols-3 items-start">
                  <Label variant="muted" className="pt-2">Default</Label>
                  <div className="col-span-2 *:w-full">
                    {selectedVariable.type === 'link' ? (
                      <LinkSettings
                        mode="standalone"
                        value={selectedVariable.default_value as LinkSettingsValue}
                        onChange={handleLinkDefaultValueChange}
                        allFields={fields}
                        collections={collections}
                      />
                    ) : selectedVariable.type === 'image' ? (
                      <ImageSettings
                        mode="standalone"
                        value={selectedVariable.default_value as ImageSettingsValue}
                        onChange={handleImageDefaultValueChange}
                        allFields={fields}
                        collections={collections}
                      />
                    ) : selectedVariable.type === 'audio' ? (
                      <AudioSettings
                        mode="standalone"
                        value={selectedVariable.default_value as AudioSettingsValue}
                        onChange={handleAudioDefaultValueChange}
                        allFields={fields}
                        collections={collections}
                      />
                    ) : selectedVariable.type === 'video' ? (
                      <VideoSettings
                        mode="standalone"
                        value={selectedVariable.default_value as VideoSettingsValue}
                        onChange={handleVideoDefaultValueChange}
                        allFields={fields}
                        collections={collections}
                      />
                    ) : selectedVariable.type === 'icon' ? (
                      <IconSettings
                        mode="standalone"
                        value={selectedVariable.default_value as IconSettingsValue}
                        onChange={handleIconDefaultValueChange}
                      />
                    ) : selectedVariable.type === 'variant' ? (() => {
                      const options = collectVariantVariableOptions(component, allComponents, selectedVariable.id);
                      const currentDefault = (selectedVariable.default_value as VariantSettingsValue | undefined)?.variant_id;
                      // Group options by component for clearer labelling when
                      // the variable is generic and links across multiple
                      // nested components.
                      const componentIds = Array.from(new Set(options.map(o => o.component_id)));
                      const showComponentName = componentIds.length > 1;

                      if (options.length === 0) {
                        return (
                          <p className="text-xs text-muted-foreground py-2">
                            Link this variable from a nested component instance to choose a default variant.
                          </p>
                        );
                      }

                      return (
                        <Select
                          value={currentDefault ?? ''}
                          onValueChange={handleVariantDefaultValueChange}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select default variant" />
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
                      );
                    })() : selectedVariable.type === 'rich_text' ? (
                      <ExpandableRichTextEditor
                        value={editingDefaultValue}
                        onChange={handleDefaultValueChange}
                        onBlur={handleDefaultValueBlur}
                        placeholder="Default value..."
                        sheetDescription={`${selectedVariable.name} default value`}
                        allFields={fields}
                        collections={collections}
                      />
                    ) : (
                      <RichTextEditor
                        value={editingDefaultValue}
                        onChange={handleDefaultValueChange}
                        onBlur={handleDefaultValueBlur}
                        placeholder="Default value..."
                        allFields={fields}
                        collections={collections}
                        withFormatting
                        showFormattingToolbar={false}
                      />
                    )}
                  </div>
                </div>

              </>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a variable or create a new one
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
