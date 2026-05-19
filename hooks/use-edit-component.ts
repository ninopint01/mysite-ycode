'use client';

/**
 * useEditComponent
 *
 * Returns a callback that opens a component in the editor, handling:
 * - Pushing the current page or parent component onto the navigation stack
 * - Loading the component's draft
 * - Navigating to the component edit URL
 * - Restoring the user's selection inside the component
 *
 * Used by both `ComponentInstanceSidebar` (Edit component button) and
 * `CenterCanvas` (double-click on a component instance on the canvas).
 */

import { useCallback } from 'react';

import { useEditorActions } from '@/hooks/use-editor-url';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { useEditorStore } from '@/stores/useEditorStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { findLayerById } from '@/lib/layer-utils';

export interface EditComponentOptions {
  /**
   * Layer to restore on exit (typically the component instance layer that was
   * interacted with on the page or in a parent component).
   */
  returnToLayerId?: string;
  /**
   * Layer inside the component to select after entering edit mode.
   * Defaults to the first child layer of the component.
   */
  initialSelectionLayerId?: string;
  /**
   * Variant to open. When entering from an instance configured for a
   * specific variant, pass its `componentVariantId` here so the editor
   * opens the correct variant instead of defaulting to the first.
   */
  variantId?: string | null;
}

export function useEditComponent(): (componentId: string, options?: EditComponentOptions) => Promise<void> {
  const { openComponent } = useEditorActions();

  return useCallback(async (componentId: string, options: EditComponentOptions = {}) => {
    const { returnToLayerId, initialSelectionLayerId, variantId: requestedVariantId } = options;

    const { loadComponentDraft, getComponentById } = useComponentsStore.getState();
    const {
      currentPageId,
      editingComponentId,
      editingComponentVariantId,
      setSelectedLayerId,
      setEditingComponentVariantId,
      pushComponentNavigation,
    } = useEditorStore.getState();
    const { pages } = usePagesStore.getState();

    const component = getComponentById(componentId);
    if (!component) return;

    // Use the requested variant (from instance) if it exists on the component,
    // otherwise fall back to the first variant.
    const validRequestedVariant = requestedVariantId
      && component.variants?.some(v => v.id === requestedVariantId)
      ? requestedVariantId
      : null;
    const targetVariantId = validRequestedVariant
      ?? (component.variants && component.variants.length > 0 ? component.variants[0].id : null);
    setEditingComponentVariantId(targetVariantId);

    setSelectedLayerId(null);

    if (editingComponentId) {
      const currentComponent = getComponentById(editingComponentId);
      if (currentComponent) {
        pushComponentNavigation({
          type: 'component',
          id: editingComponentId,
          name: currentComponent.name,
          layerId: returnToLayerId ?? null,
          variantId: editingComponentVariantId ?? null,
        });
      }
    } else if (currentPageId) {
      const currentPage = pages.find((p) => p.id === currentPageId);
      if (currentPage) {
        pushComponentNavigation({
          type: 'page',
          id: currentPageId,
          name: currentPage.name,
          layerId: returnToLayerId ?? null,
        });
      }
    }

    await loadComponentDraft(componentId);
    openComponent(componentId, currentPageId, undefined, returnToLayerId, targetVariantId);

    // Select an initial layer inside the target variant's tree.
    const { getComponentDraftLayers } = useComponentsStore.getState();
    const variantLayers = getComponentDraftLayers(componentId, targetVariantId);
    if (variantLayers && variantLayers.length > 0) {
      const currentSelection = useEditorStore.getState().selectedLayerId;
      const hasValidSelection = currentSelection && findLayerById(variantLayers, currentSelection);
      if (!hasValidSelection) {
        const target = initialSelectionLayerId
          && findLayerById(variantLayers, initialSelectionLayerId)
          ? initialSelectionLayerId
          : variantLayers[0].id;
        setSelectedLayerId(target);
      }
    }
  }, [openComponent]);
}
