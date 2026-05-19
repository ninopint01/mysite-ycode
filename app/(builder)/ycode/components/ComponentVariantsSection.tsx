'use client';

import React, { useEffect, useRef, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Icon from '@/components/ui/icon';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Component, ComponentVariant } from '@/types';

interface ComponentVariantsSectionProps {
  component: Component;
  /** Active variant id; falls back to the first variant if missing or stale. */
  activeVariantId: string | null;
  onSelectVariant: (variantId: string) => void;
  onAddVariant: () => Promise<void> | void;
  onRenameVariant: (variantId: string, name: string) => Promise<void> | void;
  onDuplicateVariant: (variantId: string) => Promise<void> | void;
  onDeleteVariant: (variantId: string) => Promise<void> | void;
  onReorderVariants: (orderedVariantIds: string[]) => Promise<void> | void;
}

interface VariantRowProps {
  variant: ComponentVariant;
  isActive: boolean;
  isOnlyVariant: boolean;
  isMenuOpen: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onMenuOpenChange: (open: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * A single sortable variant row. Mirrors the CMS sidebar row layout
 * (`SortableCollectionItem` in `CMS.tsx`) so the editor feels consistent.
 */
function VariantRow({
  variant,
  isActive,
  isOnlyVariant,
  isMenuOpen,
  onSelect,
  onStartRename,
  onMenuOpenChange,
  onDuplicate,
  onDelete,
}: VariantRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: variant.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          className={cn(
            'px-3 h-8 rounded-lg flex gap-2 items-center justify-between text-left w-full group select-none cursor-grab active:cursor-grabbing',
            // Active uses the same purple accent we apply to component
            // chips elsewhere (e.g. ComponentInstanceSidebar) so the
            // active variant visually ties back to "this is component
            // territory".
            isActive
              ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300'
              : 'hover:bg-secondary/50 text-secondary-foreground/80 dark:text-muted-foreground'
          )}
          onClick={onSelect}
          onDoubleClick={onStartRename}
        >
          <div className="flex gap-2 items-center min-w-0">
            <Icon name="component" className="size-3 shrink-0" />
            <span className="truncate" title={variant.name}>{variant.name}</span>
          </div>

          <div
            className={cn(
              'shrink-0',
              // Keep the menu trigger visible while its menu is open so the
              // user can mouse over without flicker.
              isMenuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            )}
          >
            <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="xs"
                  variant="ghost"
                  // Stop both the click (selection) and the pointerdown
                  // (drag start) — without stopping pointerdown, dnd-kit
                  // claims the gesture and the menu never opens.
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className={cn('-mr-2', isActive && 'hover:bg-purple-500/30')}
                  aria-label="Variant actions"
                >
                  <Icon name="more" className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={onStartRename}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onDuplicate}>
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  disabled={isOnlyVariant}
                  onSelect={onDelete}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-40">
        <ContextMenuItem onSelect={onStartRename}>Rename</ContextMenuItem>
        <ContextMenuItem onSelect={onDuplicate}>Duplicate</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={isOnlyVariant}
          onSelect={onDelete}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Variants list rendered above the layer tree while editing a component.
 *
 * Layout mirrors the CMS items list in the left sidebar — vertical rows with
 * an icon, name, and a hover-revealed dropdown — but uses the purple
 * component accent for the active row, and supports drag-to-reorder via
 * dnd-kit (same pattern as collections).
 */
export default function ComponentVariantsSection({
  component,
  activeVariantId,
  onSelectVariant,
  onAddVariant,
  onRenameVariant,
  onDuplicateVariant,
  onDeleteVariant,
  onReorderVariants,
}: ComponentVariantsSectionProps) {
  const variants = component.variants ?? [];
  const [renamingVariantId, setRenamingVariantId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [openMenuVariantId, setOpenMenuVariantId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Require a small drag distance before kicking off a sort, otherwise
  // single-clicks are stolen by the drag listener and never reach `onClick`.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Focus & select the rename input as soon as it mounts.
  useEffect(() => {
    if (renamingVariantId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renamingVariantId]);

  if (variants.length === 0) return null;

  const startRename = (variantId: string, currentName: string) => {
    setRenamingVariantId(variantId);
    setRenameValue(currentName);
  };

  const commitRename = async () => {
    if (!renamingVariantId) return;
    const trimmed = renameValue.trim();
    const original = variants.find(v => v.id === renamingVariantId)?.name ?? '';
    if (trimmed && trimmed !== original) {
      await onRenameVariant(renamingVariantId, trimmed);
    }
    setRenamingVariantId(null);
    setRenameValue('');
  };

  const cancelRename = () => {
    setRenamingVariantId(null);
    setRenameValue('');
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = variants.findIndex(v => v.id === active.id);
    const newIndex = variants.findIndex(v => v.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = [...variants];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    onReorderVariants(next.map(v => v.id));
  };

  return (
    <section className="border-b pb-4">
      <header className="py-5 flex justify-between shrink-0 z-20">
        <span className="font-medium">Variants</span>
        <div className="-my-1">
          <Button
            size="xs"
            variant="secondary"
            onClick={() => onAddVariant()}
            aria-label="Add variant"
          >
            <Icon name="plus" />
          </Button>
        </div>
      </header>

      <DndContext
        sensors={sensors} collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={variants.map(v => v.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-0.5">
            {variants.map((variant) => {
              const isRenaming = renamingVariantId === variant.id;

              if (isRenaming) {
                return (
                  <Input
                    key={variant.id}
                    ref={inputRef}
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    className="h-8"
                  />
                );
              }

              return (
                <VariantRow
                  key={variant.id}
                  variant={variant}
                  isActive={activeVariantId === variant.id}
                  isOnlyVariant={variants.length <= 1}
                  isMenuOpen={openMenuVariantId === variant.id}
                  onSelect={() => onSelectVariant(variant.id)}
                  onStartRename={() => startRename(variant.id, variant.name)}
                  onMenuOpenChange={(open) => setOpenMenuVariantId(open ? variant.id : null)}
                  onDuplicate={() => onDuplicateVariant(variant.id)}
                  onDelete={() => onDeleteVariant(variant.id)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
