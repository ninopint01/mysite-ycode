'use client';

/**
 * AnimationInitializer - Initializes GSAP animations based on layer interactions
 * Runs on the client to set up all animations for preview/published pages.
 *
 * Initial styles for 'on-load' mode are applied server-side via generateInitialAnimationCSS()
 * to prevent flickering. This component only handles animation triggers.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

import { ITEMS_INJECTED_EVENT, type ItemsInjectedDetail } from '@/components/FilterableCollection';
import { buildGsapProps, addTweenToTimeline, createSplitTextAnimation, generateInitialAnimationCSS, getEffectiveApplyStyle, setColorVariableResolver } from '@/lib/animation-utils';
import { getCurrentBreakpoint } from '@/lib/breakpoint-utils';
import { remapLayerIdsForCollectionItem } from '@/lib/collection-utils';
import { useColorVariablesStore } from '@/stores/useColorVariablesStore';
import type { Layer, LayerInteraction, Breakpoint } from '@/types';

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger, SplitText);
}

interface AnimationInitializerProps {
  layers: Layer[];
  injectInitialCSS?: boolean;
}

interface CollectedInteraction {
  triggerLayerId: string;
  interaction: LayerInteraction;
}

/** Recursively collect all interactions from layers */
function collectInteractions(layers: Layer[]): CollectedInteraction[] {
  const interactions: CollectedInteraction[] = [];

  const traverse = (layerList: Layer[]) => {
    layerList.forEach((layer) => {
      if (layer.interactions?.length) {
        layer.interactions.forEach((interaction) => {
          interactions.push({ triggerLayerId: layer.id, interaction });
        });
      }
      if (layer.children) {
        traverse(layer.children);
      }
    });
  };

  traverse(layers);
  return interactions;
}

/** Check if interaction should run on specified breakpoint */
function shouldRunOnBreakpoint(interaction: LayerInteraction, breakpoint: Breakpoint): boolean {
  if (!interaction.timeline?.breakpoints) return true;
  return interaction.timeline.breakpoints.includes(breakpoint);
}

/** Get element by layer ID */
function getElement(layerId: string): HTMLElement | null {
  return document.querySelector(`[data-layer-id="${layerId}"]`);
}

/**
 * Pre-paint each tween's `from` state so the element rests in its intended
 * initial appearance before the trigger fires. CSS via generateInitialAnimationCSS()
 * only covers intro triggers (load, scroll-into-view); for hover/click we apply
 * inline styles here so the layer's CSS default doesn't bleed through as the
 * `to` state.
 */
function applyInitialFromState(interaction: LayerInteraction): void {
  (interaction.tweens || []).forEach(tween => {
    if (tween.splitText) return;
    const el = getElement(tween.layer_id);
    if (!el) return;
    const { from } = buildGsapProps(tween);
    if (Object.keys(from).length > 0) {
      gsap.set(el, from);
    }
  });
}

/**
 * Collect info about elements that should start hidden based on interactions
 * Returns a map of layerId -> breakpoints (null means all breakpoints)
 */
function collectHiddenLayerInfo(interactions: CollectedInteraction[]): Map<string, string[] | null> {
  const hiddenMap = new Map<string, string[] | null>();

  interactions.forEach(({ interaction }) => {
    const breakpoints = interaction.timeline?.breakpoints || null;

    (interaction.tweens || []).forEach((tween) => {
      // Hide if display:hidden with effective on-load mode (explicit, or implicit
      // for intro triggers like load/scroll-into-view).
      if (
        tween.from?.display === 'hidden' &&
        getEffectiveApplyStyle(interaction.trigger, 'display', tween.apply_styles) === 'on-load'
      ) {
        hiddenMap.set(tween.layer_id, breakpoints);
      }
    });
  });

  return hiddenMap;
}

/**
 * Reset GSAP inline styles and restore initial data attributes for a breakpoint
 */
function resetAnimationStates(
  interactions: CollectedInteraction[],
  hiddenLayerInfo: Map<string, string[] | null>,
  newBreakpoint: Breakpoint
): void {
  // Collect all layer IDs that are targeted by animations
  const animatedLayerIds = new Set<string>();
  interactions.forEach(({ interaction }) => {
    (interaction.tweens || []).forEach((tween) => {
      animatedLayerIds.add(tween.layer_id);
    });
  });

  // Reset each animated element
  animatedLayerIds.forEach((layerId) => {
    const element = getElement(layerId);
    if (!element) return;

    // Clear GSAP inline styles
    gsap.set(element, { clearProps: 'all' });

    // Reset data-gsap-hidden attribute based on new breakpoint
    const hiddenBreakpoints = hiddenLayerInfo.get(layerId);
    if (hiddenBreakpoints !== undefined) {
      // Check if element should be hidden for the new breakpoint
      const shouldBeHidden = hiddenBreakpoints === null || hiddenBreakpoints.includes(newBreakpoint);

      if (shouldBeHidden) {
        // Restore hidden state with breakpoint info
        element.setAttribute('data-gsap-hidden', hiddenBreakpoints?.join(' ') || '');
      } else {
        // Remove hidden state - not applicable to this breakpoint
        element.removeAttribute('data-gsap-hidden');
      }
    }
  });
}

/** Build a GSAP timeline from an interaction */
function buildTimeline(interaction: LayerInteraction): gsap.core.Timeline | null {
  const isYoyo = interaction.timeline?.yoyo ?? false;

  // Track elements with display transitions for handling show/hide
  const displayTransitions: Array<{
    element: HTMLElement;
    displayStart: string | null;
    displayEnd: string | null;
  }> = [];

  // Track SplitText instances for cleanup
  const splitTextInstances: SplitText[] = [];

  // Track split elements per layer to reuse across multiple tweens
  const splitElementsCache = new Map<string, HTMLElement[]>();

  const timeline = gsap.timeline({
    paused: true,
    repeat: interaction.timeline?.repeat ?? 0,
    yoyo: isYoyo,
    onComplete: () => {
      // Clean up split text after animation completes (optional)
      // splitTextInstances.forEach(split => split.revert());
    },
  });

  // First pass: prepare all elements, split text, and collect data
  interface PreparedTween {
    element: HTMLElement;
    splitElements?: HTMLElement[];
    from: gsap.TweenVars;
    to: gsap.TweenVars;
    displayStart: string | null;
    displayEnd: string | null;
    position: string | number;
    duration: number;
    ease: string;
    splitTextConfig?: typeof interaction.tweens[0]['splitText'];
  }
  const preparedTweens: PreparedTween[] = [];

  (interaction.tweens || []).forEach((tween, index) => {
    const element = getElement(tween.layer_id);
    if (!element) return;

    // Apply split text if configured using GSAP's SplitText
    let splitElements: HTMLElement[] | undefined;
    if (tween.splitText) {
      // Check if we've already split this element in this timeline
      const cacheKey = `${tween.layer_id}_${tween.splitText.type}`;

      if (splitElementsCache.has(cacheKey)) {
        // Reuse existing split elements
        splitElements = splitElementsCache.get(cacheKey);
      } else {
        // Create new split for this element
        const result = createSplitTextAnimation(
          element,
          tween.splitText,
          tween,
          gsap,
          SplitText
        );

        if (result) {
          splitTextInstances.push(result.splitInstance);
          splitElements = result.splitElements;
          // Cache the split elements for reuse
          splitElementsCache.set(cacheKey, result.splitElements);
        }
      }
    }

    const { from, to, displayStart, displayEnd } = buildGsapProps(tween);

    // Calculate position for timeline
    let position: string | number = 0;
    if (typeof tween.position === 'number') {
      position = tween.position;
    } else if (tween.position === '>' && index > 0) {
      position = '>';
    } else if (tween.position === '<' && index > 0) {
      position = '<';
    }

    // Track display transitions for this tween
    if (displayStart !== displayEnd) {
      displayTransitions.push({ element, displayStart, displayEnd });
    }

    preparedTweens.push({
      element,
      splitElements,
      from,
      to,
      displayStart,
      displayEnd,
      position,
      duration: tween.duration,
      ease: tween.ease,
      splitTextConfig: tween.splitText,
    });
  });

  // Second pass: Add all tweens to timeline
  // For each tween, apply its "from" state at the same position it starts
  preparedTweens.forEach(({ element, splitElements, from, to, displayStart, displayEnd, position, duration, ease, splitTextConfig }) => {
    // Apply the "from" state at the same position as the tween starts
    // This ensures sequenced animations have correct initial state when they begin
    if (Object.keys(from).length > 0) {
      const targets = splitElements && splitElements.length > 0 ? splitElements : element;
      timeline.set(targets, from, position);
    }

    // Add tween to timeline using shared utility
    addTweenToTimeline(timeline, {
      element,
      from,
      to,
      duration,
      ease,
      position,
      splitText: splitTextConfig,
      splitElements,
      onComplete: displayEnd === 'hidden'
        ? () => element.setAttribute('data-gsap-hidden', '')
        : undefined,
    });
  });

  // Handle display state changes based on timeline direction
  if (displayTransitions.length > 0) {
    // When timeline starts playing forward, set elements to their "end" display state
    timeline.eventCallback('onStart', () => {
      displayTransitions.forEach(({ element, displayEnd }) => {
        if (displayEnd === 'visible') {
          element.removeAttribute('data-gsap-hidden');
        }
      });
    });

    // When timeline reverses back to start, restore initial display states
    if (isYoyo) {
      timeline.eventCallback('onReverseComplete', () => {
        displayTransitions.forEach(({ element, displayStart }) => {
          if (displayStart === 'hidden') {
            element.setAttribute('data-gsap-hidden', '');
          } else {
            element.removeAttribute('data-gsap-hidden');
          }
        });
      });
    }
  }

  return timeline;
}

export default function AnimationInitializer({ layers, injectInitialCSS }: AnimationInitializerProps) {
  const cleanupRef = useRef<(() => void)[]>([]);
  const timelinesRef = useRef<Map<string, gsap.core.Timeline>>(new Map());
  // ScrollTriggers for one-shot `scroll-into-view` intros, keyed by
  // interaction id. Tracked separately so effect re-runs can detach a played
  // trigger without killing its in-flight timeline (see detachAnimations).
  const scrollTriggersRef = useRef<Map<string, ScrollTrigger>>(new Map());
  const prevBreakpointRef = useRef<Breakpoint | null>(null);
  const [currentBreakpoint, setCurrentBreakpoint] = useState<Breakpoint>(() => getCurrentBreakpoint());
  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Tracks interaction ids whose one-shot animation (`load` or
  // `scroll-into-view`) has already played. Keyed by interaction id, which
  // is stable across effect re-runs for the same logical element:
  // - Page-level layers keep their original id.
  // - Filter/load-more items get `-fc-${itemId}` appended, so the same item
  //   re-injected later (e.g. filter toggled) keeps the same id and is
  //   skipped — no replay.
  // Cleared on breakpoint changes since `resetAnimationStates` restores
  // initial styles and animations need to re-run for the new breakpoint.
  const playedOneShotInteractionsRef = useRef<Set<string>>(new Set());

  // Extra layers built from collection items injected client-side (filter
  // refetch, load-more). Indexed by collection layer id so a filter
  // deactivation can drop just that collection's extras. Each value uses the
  // `-fc-${itemId}` suffix that mirrors the server-side filter renderer.
  const [extrasByCollection, setExtrasByCollection] = useState<Record<string, Layer[]>>({});

  // Forces the bind effect to re-run when tracked DOM elements get remounted
  // (e.g. when dynamic-imported wrappers like LoadMoreCollection finish loading
  // and React replaces the Suspense fallback with their real subtree). Without
  // this, gsap.set() and listeners attached on first paint die with the old
  // nodes and the new ones never animate until the next state change.
  const [rebindTick, setRebindTick] = useState(0);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ItemsInjectedDetail>).detail;
      const { collectionLayerId, layerTemplate, itemIds, append, collectionLayer } = detail || {};
      if (!collectionLayerId || !collectionLayer || !layerTemplate) return;

      setExtrasByCollection(prev => {
        // Empty itemIds = filter deactivated, drop this collection's extras.
        if (!append && (!itemIds || itemIds.length === 0)) {
          if (!(collectionLayerId in prev)) return prev;
          const next = { ...prev };
          delete next[collectionLayerId];
          return next;
        }
        // Rebuild the full collection layer per item so interactions on the
        // wrapper itself are bound, then remap ids once.
        const newLayers: Layer[] = itemIds.map(itemId => {
          const fullLayer: Layer = { ...collectionLayer, children: layerTemplate };
          return remapLayerIdsForCollectionItem(fullLayer, `-fc-${itemId}`);
        });
        if (append) {
          return {
            ...prev,
            [collectionLayerId]: [...(prev[collectionLayerId] || []), ...newLayers],
          };
        }
        return { ...prev, [collectionLayerId]: newLayers };
      });
    };
    window.addEventListener(ITEMS_INJECTED_EVENT, handler);
    return () => window.removeEventListener(ITEMS_INJECTED_EVENT, handler);
  }, []);

  const effectiveLayers = useMemo(() => {
    const extras = Object.values(extrasByCollection).flat();
    return extras.length > 0 ? [...layers, ...extras] : layers;
  }, [layers, extrasByCollection]);

  // Register a color variable resolver so backgroundColor tweens that
  // reference color variables (e.g. "color:var(--id)") can be resolved to a
  // concrete rgba value GSAP can interpolate.
  useEffect(() => {
    setColorVariableResolver((id) => useColorVariablesStore.getState().getVariableById(id)?.value);
    return () => setColorVariableResolver(null);
  }, []);

  // Inject initial animation CSS for subtrees not covered by the page-level style tag
  // (e.g. components embedded in rich text whose layer IDs are namespaced differently)
  useEffect(() => {
    if (!injectInitialCSS) return;
    const { css, hiddenLayerInfo } = generateInitialAnimationCSS(effectiveLayers);
    if (css) {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.appendChild(style);
      styleRef.current = style;

      // Apply data-gsap-hidden to elements that should start hidden
      hiddenLayerInfo.forEach(({ layerId, breakpoints }) => {
        const el = getElement(layerId);
        if (el) {
          el.setAttribute('data-gsap-hidden', breakpoints || '');
        }
      });
    }
    return () => {
      if (styleRef.current) {
        styleRef.current.remove();
        styleRef.current = null;
      }
    };
  }, [injectInitialCSS, effectiveLayers]);

  // Listen for breakpoint changes on resize
  useEffect(() => {
    const handleResize = () => {
      const newBreakpoint = getCurrentBreakpoint();
      setCurrentBreakpoint((prev) => (prev !== newBreakpoint ? newBreakpoint : prev));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const collectedInteractions = collectInteractions(effectiveLayers);
    const hiddenLayerInfo = collectHiddenLayerInfo(collectedInteractions);
    const isBreakpointChange = prevBreakpointRef.current !== null && prevBreakpointRef.current !== currentBreakpoint;

    // Reset animation states when breakpoint changes
    if (isBreakpointChange) {
      resetAnimationStates(collectedInteractions, hiddenLayerInfo, currentBreakpoint);
      playedOneShotInteractionsRef.current = new Set();
    }

    // Update previous breakpoint reference
    prevBreakpointRef.current = currentBreakpoint;

    // Detach animations from the previous run. One-shot intros (load,
    // scroll-into-view) that have already played keep their timeline so
    // effect re-runs (filter/load-more state changes, Suspense resolution)
    // don't freeze a mid-flight animation. The early break in the
    // per-trigger switch below avoids rebuilding their timelines/triggers.
    //
    // `scrollTrigger.kill()` defaults to also killing its linked timeline,
    // so a played trigger must be detached with `kill(false, true)` to keep
    // the animation running. Defined as a closure so the unmount/return
    // cleanup can reuse it.
    const detachAnimations = () => {
      const playedIds = playedOneShotInteractionsRef.current;
      scrollTriggersRef.current.forEach((st, interactionId) => {
        // allowAnimation = played → don't kill the in-flight timeline.
        st.kill(false, playedIds.has(interactionId));
        scrollTriggersRef.current.delete(interactionId);
      });
      timelinesRef.current.forEach((tl, interactionId) => {
        if (!playedIds.has(interactionId)) {
          tl.kill();
          timelinesRef.current.delete(interactionId);
        }
      });
    };

    cleanupRef.current.forEach((cleanup) => cleanup());
    cleanupRef.current = [];
    detachAnimations();

    collectedInteractions.forEach(({ triggerLayerId, interaction }) => {
      const triggerElement = getElement(triggerLayerId);
      if (!triggerElement) return;

      const { trigger } = interaction;

      // Intro triggers (load, scroll-into-view) get their `from` state via
      // server-emitted CSS. For hover/click, paint the `from` state inline so
      // the resting appearance matches the author's intent instead of the
      // layer's CSS default.
      if (trigger === 'hover' || trigger === 'click') {
        if (shouldRunOnBreakpoint(interaction, currentBreakpoint)) {
          applyInitialFromState(interaction);
        }
      }

      // Helper to get or create timeline (always lazy to avoid GSAP setting inline styles)
      // Initial styles are handled by CSS via generateInitialAnimationCSS()
      const getTimeline = (): gsap.core.Timeline | null => {
        let tl = timelinesRef.current.get(interaction.id) || null;
        if (!tl) {
          tl = buildTimeline(interaction);
          if (tl) timelinesRef.current.set(interaction.id, tl);
        }
        return tl;
      };

      switch (trigger) {
        case 'load': {
          if (!shouldRunOnBreakpoint(interaction, currentBreakpoint)) break;
          // Skip if this interaction has already played. Stops effect
          // re-runs (caused by filter/load-more state changes) from
          // re-playing load animations on existing elements, and also
          // prevents re-playing for filter items that get re-injected.
          if (playedOneShotInteractionsRef.current.has(interaction.id)) break;
          playedOneShotInteractionsRef.current.add(interaction.id);

          const timeline = getTimeline();
          timeline?.play();
          break;
        }

        case 'click': {
          let isForward = true;
          const isLooped = (interaction.timeline?.repeat ?? 0) !== 0;

          const handleClick = () => {
            // Check breakpoint at trigger time for interactive triggers
            if (!shouldRunOnBreakpoint(interaction, getCurrentBreakpoint())) return;

            const timeline = getTimeline();
            if (!timeline) return;

            if (isLooped) {
              if (timeline.isActive()) {
                timeline.pause();
              } else {
                timeline.play();
              }
            } else if (interaction.timeline?.yoyo) {
              if (isForward) {
                timeline.play();
              } else {
                timeline.reverse();
              }
              isForward = !isForward;
            } else {
              timeline.invalidate().restart();
            }
          };

          triggerElement.addEventListener('click', handleClick);
          cleanupRef.current.push(() => triggerElement.removeEventListener('click', handleClick));
          break;
        }

        case 'hover': {
          const handleMouseEnter = () => {
            // Check breakpoint at trigger time for interactive triggers
            if (!shouldRunOnBreakpoint(interaction, getCurrentBreakpoint())) return;
            getTimeline()?.play();
          };
          const handleMouseLeave = () => {
            // Check breakpoint at trigger time for interactive triggers
            if (!shouldRunOnBreakpoint(interaction, getCurrentBreakpoint())) return;
            if (interaction.timeline?.yoyo) {
              timelinesRef.current.get(interaction.id)?.reverse();
            }
          };

          triggerElement.addEventListener('mouseenter', handleMouseEnter);
          triggerElement.addEventListener('mouseleave', handleMouseLeave);
          cleanupRef.current.push(() => {
            triggerElement.removeEventListener('mouseenter', handleMouseEnter);
            triggerElement.removeEventListener('mouseleave', handleMouseLeave);
          });
          break;
        }

        case 'scroll-into-view': {
          if (!shouldRunOnBreakpoint(interaction, currentBreakpoint)) break;
          // Already fired in a previous effect run — don't recreate the
          // trigger (which would re-fire `play` if the element is still in
          // viewport after a filter/load-more state change).
          if (playedOneShotInteractionsRef.current.has(interaction.id)) break;

          const scrollStart = interaction.timeline?.scrollStart || 'top 80%';
          const toggleActions = interaction.timeline?.toggleActions || 'play none none none';

          const timeline = getTimeline();
          if (!timeline) break;

          const scrollTrigger = ScrollTrigger.create({
            trigger: triggerElement,
            start: scrollStart,
            toggleActions,
            animation: timeline as any,
            onEnter: () => {
              playedOneShotInteractionsRef.current.add(interaction.id);
            },
          });

          // Tracked in scrollTriggersRef (not cleanupRef) so a played trigger
          // can be detached on re-run without killing its in-flight timeline.
          scrollTriggersRef.current.set(interaction.id, scrollTrigger);
          break;
        }

        case 'while-scrolling': {
          // Skip if breakpoint restriction not met
          if (!shouldRunOnBreakpoint(interaction, currentBreakpoint)) break;

          // Scrub animations require timeline upfront
          const timeline = getTimeline();
          if (!timeline) break;

          const scrollStart = interaction.timeline?.scrollStart || 'top bottom';
          const scrollEnd = interaction.timeline?.scrollEnd || 'bottom top';
          const scrub = interaction.timeline?.scrub ?? 1;

          const scrollTrigger = ScrollTrigger.create({
            trigger: triggerElement,
            start: scrollStart,
            end: scrollEnd,
            scrub,
            animation: timeline,
          });

          cleanupRef.current.push(() => scrollTrigger.kill());
          break;
        }
      }
    });

    // Watch for tracked elements being remounted (e.g. dynamic chunk loading
    // for LoadMoreCollection/FilterableCollection replaces the Suspense fallback
    // with the real subtree). When a node carrying a tracked data-layer-id
    // appears in the DOM, bump rebindTick to re-run this effect against the
    // fresh nodes — re-applying gsap.set() and rebinding listeners.
    const trackedLayerIds = new Set<string>();
    collectedInteractions.forEach(({ triggerLayerId, interaction }) => {
      trackedLayerIds.add(triggerLayerId);
      (interaction.tweens || []).forEach(t => trackedLayerIds.add(t.layer_id));
    });

    let rebindTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRebind = () => {
      if (rebindTimer) return;
      rebindTimer = setTimeout(() => {
        rebindTimer = null;
        setRebindTick(t => t + 1);
      }, 50);
    };

    const containsTrackedId = (node: Node): boolean => {
      if (!(node instanceof Element)) return false;
      const id = node.getAttribute('data-layer-id');
      if (id && trackedLayerIds.has(id)) return true;
      // Check descendants — items often nest deeply
      const descendants = node.querySelectorAll('[data-layer-id]');
      for (const el of descendants) {
        const cid = el.getAttribute('data-layer-id');
        if (cid && trackedLayerIds.has(cid)) return true;
      }
      return false;
    };

    const remountObserver = new MutationObserver(mutations => {
      for (const m of mutations) {
        if (m.type !== 'childList') continue;
        for (const n of m.addedNodes) {
          if (containsTrackedId(n)) {
            scheduleRebind();
            return;
          }
        }
      }
    });
    remountObserver.observe(document.body, { childList: true, subtree: true });

    // Capture ref values for cleanup
    const cleanups = cleanupRef.current;

    return () => {
      if (rebindTimer) clearTimeout(rebindTimer);
      remountObserver.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      // Detach played one-shots without killing their timeline (see note at
      // top of effect), then sweep any remaining triggers. Preserved
      // timelines have already been unlinked via kill(false, true), so the
      // sweep below can't touch them.
      detachAnimations();
      ScrollTrigger.getAll().forEach((st) => st.kill());
    };
  }, [effectiveLayers, currentBreakpoint, rebindTick]);

  return null;
}
