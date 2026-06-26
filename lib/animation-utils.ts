/**
 * Animation utility functions and constants for GSAP interactions
 */

import type { InteractionTween, LayerInteraction, TweenProperties, Layer, Breakpoint, ApplyStyles, TweenPropertyKey } from '@/types';
import { BREAKPOINTS } from '@/lib/breakpoint-utils';

/**
 * One-shot intro triggers where the `from` state should be applied on initial
 * paint to avoid the element flashing in its `to` state before JS runs.
 */
const IMPLICIT_ON_LOAD_TRIGGERS: ReadonlyArray<LayerInteraction['trigger']> = ['load', 'scroll-into-view'];

/**
 * Returns the effective apply mode for a tween property. Honors an explicit
 * `apply_styles` choice; otherwise falls back to `on-load` for intro
 * triggers (load, scroll-into-view) so new intro animations stay
 * flicker-free, and `on-trigger` for everything else.
 */
export function getEffectiveApplyStyle(
  trigger: LayerInteraction['trigger'],
  propertyKey: TweenPropertyKey,
  applyStyles: InteractionTween['apply_styles'] | undefined
): ApplyStyles {
  const explicit = applyStyles?.[propertyKey];
  if (explicit) return explicit;
  if (IMPLICIT_ON_LOAD_TRIGGERS.includes(trigger)) return 'on-load';
  return 'on-trigger';
}

/**
 * Default `apply_styles` for a new tween based on the interaction trigger.
 * Intro triggers default every property to `on-load` to avoid flicker.
 */
export function getDefaultApplyStyles(trigger: LayerInteraction['trigger']): InteractionTween['apply_styles'] {
  const mode: ApplyStyles = IMPLICIT_ON_LOAD_TRIGGERS.includes(trigger) ? 'on-load' : 'on-trigger';
  return {
    x: mode,
    y: mode,
    rotation: mode,
    scale: mode,
    skewX: mode,
    skewY: mode,
    autoAlpha: mode,
    display: mode,
  };
}

/**
 * Creates a SplitText instance with responsive animation support
 * @param element - The element to split
 * @param config - SplitText configuration
 * @param tween - The tween configuration for animation
 * @param gsapInstance - GSAP instance to use for animations
 * @returns Object with splitElements array and the SplitText instance
 */
export function createSplitTextAnimation(
  element: HTMLElement,
  config: { type: 'chars' | 'words' | 'lines'; stagger: { amount: number } },
  tween: InteractionTween,
  gsapInstance: any,
  SplitTextClass: any
): { splitElements: HTMLElement[]; splitInstance: any } | null {
  try {
    const splitInstance = new SplitTextClass(element, {
      type: config.type,
    });

    // Get the split elements array from the instance
    const splitProperty = config.type === 'chars' ? 'chars' :
      config.type === 'words' ? 'words' : 'lines';
    const createdElements = splitInstance[splitProperty] as HTMLElement[];

    if (!createdElements || createdElements.length === 0) {
      console.warn(`SplitText created but no ${config.type} elements found.`);
      try {
        splitInstance.revert();
      } catch (error) {
        // Ignore revert errors
      }
      return null;
    }

    return { splitElements: createdElements, splitInstance };
  } catch (error) {
    console.warn('Failed to create SplitText:', error);
    return null;
  }
}

// Types
export type TriggerType = 'click' | 'hover' | 'scroll-into-view' | 'while-scrolling' | 'load';
export type PropertyType = 'position-x' | 'position-y' | 'scale' | 'rotation' | 'skew-x' | 'skew-y' | 'opacity' | 'width' | 'height' | 'background-color' | 'display' | 'split-text' | 'blur' | 'brightness' | 'grayscale';

export interface PropertyConfig {
  key: keyof TweenProperties;
  unit: string;
  defaultFrom: string | null;
  defaultFromAfterCurrent: string;
  defaultTo: string | null;
  options?: Array<{ value: string; label: string }>;
  /** If true, only show the "to" value in UI (no "from" input) */
  toOnly?: boolean;
  /** Available units for this property — enables unit selector in UI */
  units?: string[];
}

export interface PropertyOption {
  type: PropertyType;
  label: string;
  properties: PropertyConfig[];
}

// Unit constants
const POSITION_UNITS = ['px', '%', 'rem', 'em', 'vw', 'vh', 'svh', 'dvh'];
const ANGLE_UNITS = ['deg', 'rad', 'turn'];
const SIZE_UNITS = ['px', '%', 'rem', 'em', 'vh', 'svh', 'dvh'];

export interface ParsedAnimationValue {
  number: string;
  unit: string;
}

/** Splits a CSS value into number and unit parts. Falls back to defaultUnit for bare numbers. */
export function parseAnimationValue(value: string | null | undefined, defaultUnit: string): ParsedAnimationValue {
  if (!value) return { number: '', unit: defaultUnit };

  const trimmed = value.trim();
  if (!trimmed) return { number: '', unit: defaultUnit };

  // Special non-numeric values (auto, etc.) — return as-is with empty unit
  if (!/^-?[\d.]/.test(trimmed)) return { number: trimmed, unit: '' };

  // Match number followed by optional unit
  const match = trimmed.match(/^(-?[\d.]+)\s*(.*)$/);
  if (!match) return { number: trimmed, unit: defaultUnit };

  const num = match[1];
  const unitPart = match[2] || defaultUnit;

  return { number: num, unit: unitPart };
}

/** Combines a number and unit into a single CSS value string */
export function formatAnimationValue(number: string, unit: string): string {
  if (!number) return '';
  if (!unit) return number;
  return `${number}${unit}`;
}

// Optional module-level resolver for ColorPicker color variable references
// (e.g. "color:var(--{id})"). Consumers can register a resolver so GSAP
// receives raw rgba values that it can interpolate; without one, the CSS
// `var(--id)` form is emitted instead (suitable for static initial CSS where
// the browser resolves it natively).
let _colorVariableResolver: ((id: string) => string | undefined) | null = null;

/** Register a resolver mapping a color variable id to its raw value
 * ("#hex" or "#hex/opacity"). Pass null to clear. */
export function setColorVariableResolver(
  resolver: ((id: string) => string | undefined) | null
): void {
  _colorVariableResolver = resolver;
}

/**
 * Convert a ColorPicker-formatted color (`#hex`, `#hex/opacity`, or
 * `color:var(--id)`) to a CSS-tweenable string. Plain hex strings are
 * returned as-is.
 */
function colorToCss(value: string): string {
  if (!value) return value;

  const varMatch = value.match(/^color:var\(--([^)]+)\)$/);
  if (varMatch) {
    const id = varMatch[1];
    const raw = _colorVariableResolver?.(id);
    if (raw) return colorToCss(raw);
    // Fallback: emit a plain CSS var() — the browser resolves it natively
    // (e.g. for SSR-injected initial animation styles).
    return `var(--${id})`;
  }

  const parts = value.split('/');
  if (parts.length < 2) return value;
  const hex = parts[0];
  const opacity = parseInt(parts[1], 10) / 100;
  if (Number.isNaN(opacity)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r},${g},${b},${opacity})`;
}

// Constants
export const PROPERTY_OPTIONS: PropertyOption[] = [
  {
    type: 'position-x',
    label: 'Position X',
    properties: [{
      key: 'x',
      unit: 'px',
      units: POSITION_UNITS,
      defaultFrom: '0px',
      defaultFromAfterCurrent: '0px',
      defaultTo: '100px',
    }],
  },
  {
    type: 'position-y',
    label: 'Position Y',
    properties: [{
      key: 'y',
      unit: 'px',
      units: POSITION_UNITS,
      defaultFrom: '0px',
      defaultFromAfterCurrent: '0px',
      defaultTo: '100px',
    }],
  },
  {
    type: 'scale',
    label: 'Scale',
    properties: [{
      key: 'scale',
      unit: '',
      defaultFrom: '1',
      defaultFromAfterCurrent: '1',
      defaultTo: '1.3',
    }],
  },
  {
    type: 'rotation',
    label: 'Rotation',
    properties: [{
      key: 'rotation',
      unit: 'deg',
      units: ANGLE_UNITS,
      defaultFrom: '0deg',
      defaultFromAfterCurrent: '0deg',
      defaultTo: '45deg',
    }],
  },
  {
    type: 'skew-x',
    label: 'Skew X',
    properties: [{
      key: 'skewX',
      unit: 'deg',
      units: ANGLE_UNITS,
      defaultFrom: '0deg',
      defaultFromAfterCurrent: '0deg',
      defaultTo: '30deg',
    }],
  },
  {
    type: 'skew-y',
    label: 'Skew Y',
    properties: [{
      key: 'skewY',
      unit: 'deg',
      units: ANGLE_UNITS,
      defaultFrom: '0deg',
      defaultFromAfterCurrent: '0deg',
      defaultTo: '30deg',
    }],
  },
  {
    type: 'opacity',
    label: 'Opacity',
    properties: [{
      key: 'autoAlpha',
      unit: '%',
      defaultFrom: '100',
      defaultFromAfterCurrent: '100',
      defaultTo: '0',
    }],
  },
  {
    type: 'height',
    label: 'Height',
    properties: [{
      key: 'height',
      unit: 'px',
      units: SIZE_UNITS,
      defaultFrom: '0px',
      defaultFromAfterCurrent: '0px',
      defaultTo: '100px',
    }],
  },
  {
    type: 'width',
    label: 'Width',
    properties: [{
      key: 'width',
      unit: 'px',
      units: SIZE_UNITS,
      defaultFrom: '0px',
      defaultFromAfterCurrent: '0px',
      defaultTo: '100px',
    }],
  },
  {
    type: 'background-color',
    label: 'Background color',
    properties: [{
      key: 'backgroundColor',
      unit: '',
      defaultFrom: '#ffffff',
      defaultFromAfterCurrent: '#ffffff',
      defaultTo: '#000000',
    }],
  },
  {
    type: 'display',
    label: 'Display',
    properties: [{
      key: 'display',
      unit: '',
      defaultFrom: null,
      defaultFromAfterCurrent: 'visible',
      defaultTo: 'hidden',
      options: [
        { value: 'visible', label: 'Visible' },
        { value: 'hidden', label: 'Hidden' },
      ],
    }],
  },
  {
    type: 'blur',
    label: 'Blur',
    properties: [{
      key: 'filterBlur',
      unit: 'px',
      defaultFrom: '0',
      defaultFromAfterCurrent: '0',
      defaultTo: '5',
    }],
  },
  {
    type: 'brightness',
    label: 'Brightness',
    properties: [{
      key: 'filterBrightness',
      unit: '',
      defaultFrom: '1',
      defaultFromAfterCurrent: '1',
      defaultTo: '1.15',
    }],
  },
  {
    type: 'grayscale',
    label: 'Grayscale',
    properties: [{
      key: 'filterGrayscale',
      unit: '%',
      defaultFrom: '0',
      defaultFromAfterCurrent: '0',
      defaultTo: '100',
    }],
  },
];

/** Keys whose values participate in the combined CSS `filter` property */
export const FILTER_PROPERTY_KEYS = ['filterBlur', 'filterBrightness', 'filterGrayscale'] as const;
export type FilterPropertyKey = typeof FILTER_PROPERTY_KEYS[number];

/** Map a filter sub-property key to its CSS function name */
const FILTER_CSS_FUNCTIONS: Record<FilterPropertyKey, string> = {
  filterBlur: 'blur',
  filterBrightness: 'brightness',
  filterGrayscale: 'grayscale',
};

/** Check if a tween property key contributes to the combined CSS `filter` property */
export function isFilterPropertyKey(key: string): key is FilterPropertyKey {
  return (FILTER_PROPERTY_KEYS as readonly string[]).includes(key);
}

/**
 * Build the CSS `filter` string from a set of sub-property values.
 * Only includes defined functions; returns `null` if none are set.
 */
export function buildFilterString(values: Partial<Record<FilterPropertyKey, string | null | undefined>>): string | null {
  const parts: string[] = [];
  for (const key of FILTER_PROPERTY_KEYS) {
    const raw = values[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const cfg = PROPERTY_OPTIONS
      .flatMap((opt) => opt.properties)
      .find((p) => p.key === key);
    if (!cfg) continue;
    const cssVal = resolveCssValue(raw, cfg);
    parts.push(`${FILTER_CSS_FUNCTIONS[key]}(${cssVal})`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  'click': 'Click',
  'hover': 'Hover',
  'scroll-into-view': 'Scroll into view',
  'while-scrolling': 'While scrolling',
  'load': 'Page load',
};

export const START_POSITION_OPTIONS: Record<string, { short: string; long: string }> = {
  '>': { short: 'After previous', long: 'After previous animation ends' },
  '<': { short: 'With previous', long: 'With the previous animation' },
  'at': { short: 'At', long: 'At a specific time' },
};

export const TOGGLE_ACTION_OPTIONS = [
  { value: 'play', label: 'Play' },
  { value: 'pause', label: 'Pause' },
  { value: 'resume', label: 'Resume' },
  { value: 'reverse', label: 'Reverse' },
  { value: 'restart', label: 'Restart' },
  { value: 'reset', label: 'Reset' },
  { value: 'complete', label: 'Complete' },
  { value: 'none', label: 'Ignore' },
];

export const EASE_OPTIONS = [
  { value: 'none', label: 'Linear', icon: 'ease-linear' },
  { value: 'power1.in', label: 'Ease in', icon: 'ease-in' },
  { value: 'power1.inOut', label: 'Ease in out', icon: 'ease-in-out' },
  { value: 'power1.out', label: 'Ease out', icon: 'ease-out' },
  { value: 'back.in', label: 'Back in', icon: 'ease-back-in' },
  { value: 'back.inOut', label: 'Back in out', icon: 'ease-back-in-out' },
  { value: 'back.out', label: 'Back out', icon: 'ease-back-out' },
] as const;

// Utility functions

/** Calculate the actual start time in seconds for a tween */
export function calculateTweenStartTime(tweens: InteractionTween[], index: number): number {
  const tween = tweens[index];
  if (typeof tween.position === 'number') {
    return tween.position;
  }
  if (index === 0) {
    return 0;
  }
  const prevStart = calculateTweenStartTime(tweens, index - 1);
  const prevTween = tweens[index - 1];
  const prevDuration = prevTween.duration;
  // Include stagger amount if splitText is enabled on the previous tween
  const prevStaggerAmount = prevTween.splitText?.stagger?.amount || 0;
  if (tween.position === '>') {
    return prevStart + prevDuration + prevStaggerAmount;
  }
  if (tween.position === '<') {
    return prevStart;
  }
  return 0;
}

/**
 * Resolve a stored value into a CSS-compatible string.
 * Multi-unit properties store value with unit (e.g. "100px"); bare numbers get the default unit.
 */
export function resolveCssValue(value: string, prop: PropertyConfig): string {
  if (prop.units) {
    if (/^-?[\d.]+$/.test(value)) return `${value}${prop.unit}`;
    return value;
  }
  return prop.unit ? `${value}${prop.unit}` : value;
}

/** Convert a property value to GSAP-compatible format */
export function toGsapValue(value: string | null | undefined, prop: PropertyConfig): string | number | undefined {
  if (value === null || value === undefined) return undefined;
  if (prop.key === 'autoAlpha') {
    return Number(value) / 100;
  }
  if (prop.key === 'backgroundColor') {
    return colorToCss(value);
  }
  return resolveCssValue(value, prop);
}

/** Get all property options that are set in a tween (check both from and to) */
export function getTweenProperties(tween: InteractionTween): PropertyOption[] {
  return PROPERTY_OPTIONS.filter((opt) =>
    opt.properties.some((p) => {
      const hasFrom = tween.from[p.key] !== undefined && tween.from[p.key] !== null;
      const hasTo = tween.to[p.key] !== undefined && tween.to[p.key] !== null;
      return hasFrom || hasTo;
    })
  );
}

/** Check if a property type is already added to a tween */
export function isPropertyInTween(tween: InteractionTween, propertyType: PropertyType): boolean {
  // Special handling for split-text
  if (propertyType === 'split-text') {
    return !!tween.splitText;
  }

  const propertyOption = PROPERTY_OPTIONS.find((p) => p.type === propertyType);
  if (!propertyOption) return false;
  return propertyOption.properties.some((p) => {
    const hasFrom = tween.from[p.key] !== undefined && tween.from[p.key] !== null;
    const hasTo = tween.to[p.key] !== undefined && tween.to[p.key] !== null;
    return hasFrom || hasTo;
  });
}

export interface GsapAnimationProps {
  from: Record<string, string | number>;
  to: Record<string, string | number>;
  displayStart: string | null; /** Display value to set at the START of animation (when showing) */
  displayEnd: string | null; /** Display value to set at the END of animation (when hiding) */
}

/**
 * Build GSAP-compatible from/to props from a tween.
 * Display is handled separately - it should be applied:
 * - At START when showing (going TO visible/auto) - so element is visible during animation
 * - At END when hiding (going TO none) - so element stays visible during animation
 */
/**
 * Result of generating initial animation CSS
 */
export interface HiddenLayerInfo {
  layerId: string;
  breakpoints: string | null; // null = all breakpoints, otherwise space-separated like "mobile" or "mobile tablet"
}

export interface InitialAnimationResult {
  css: string;
  hiddenLayerInfo: HiddenLayerInfo[];
}

/**
 * Info about a layer that should be hidden on canvas in edit mode
 */
export interface EditorHiddenLayerInfo {
  layerId: string;
  breakpoints: Breakpoint[]; // Empty array means all breakpoints
}

/**
 * Whether a tween's on-load `from` state leaves the element hidden, so the
 * editor should hide it by default and reveal it on selection. Covers explicit
 * `display: hidden` (any trigger) plus toggle triggers (hover/click) whose
 * resting state hides via opacity, scale-to-zero, or a translate that moves the
 * element away (e.g. a slide-out dropdown clipped by an `overflow-hidden`
 * wrapper). Intro triggers (load/scroll-into-view) reveal permanent content, so
 * their transform/opacity `from` states must NOT hide it in the editor.
 */
function tweenHidesOnLoad(interaction: LayerInteraction, tween: InteractionTween): boolean {
  const { trigger } = interaction;
  const from = tween.from;
  if (!from) return false;
  const apply = tween.apply_styles;

  if (from.display === 'hidden' && getEffectiveApplyStyle(trigger, 'display', apply) === 'on-load') {
    return true;
  }

  if (trigger !== 'hover' && trigger !== 'click') return false;

  const isOnLoad = (key: TweenPropertyKey) => getEffectiveApplyStyle(trigger, key, apply) === 'on-load';
  const num = (v: unknown) => (v === null || v === undefined ? NaN : parseFloat(String(v)));

  if (from.autoAlpha != null && isOnLoad('autoAlpha') && num(from.autoAlpha) === 0) return true;
  if (from.scale != null && isOnLoad('scale') && num(from.scale) === 0) return true;
  if (from.x != null && isOnLoad('x') && num(from.x) !== 0) return true;
  if (from.y != null && isOnLoad('y') && num(from.y) !== 0) return true;

  return false;
}

/**
 * Collect layer IDs that should be visually hidden on canvas in edit mode
 * (display: hidden, or a toggle's on-load hidden resting state) so they're
 * revealed only when selected. Returns a Map of layerId -> breakpoints
 * (empty = all breakpoints).
 */
export function collectEditorHiddenLayerIds(layers: Layer[]): Map<string, Breakpoint[]> {
  const hiddenLayerMap = new Map<string, Breakpoint[]>();

  const traverse = (layerList: Layer[]) => {
    layerList.forEach((layer) => {
      if (layer.interactions) {
        layer.interactions.forEach((interaction) => {
          (interaction.tweens || []).forEach((tween) => {
            if (tweenHidesOnLoad(interaction, tween)) {
              const breakpoints = interaction.timeline?.breakpoints || [];
              const existing = hiddenLayerMap.get(tween.layer_id);

              if (existing !== undefined) {
                // If we already have an entry:
                // - If either has empty breakpoints (all), result is all
                // - Otherwise merge breakpoints
                if (existing.length === 0 || breakpoints.length === 0) {
                  hiddenLayerMap.set(tween.layer_id, []);
                } else {
                  // Merge unique breakpoints
                  const merged = [...new Set([...existing, ...breakpoints])];
                  hiddenLayerMap.set(tween.layer_id, merged as Breakpoint[]);
                }
              } else {
                hiddenLayerMap.set(tween.layer_id, breakpoints);
              }
            }
          });
        });
      }

      if (layer.children) {
        traverse(layer.children);
      }
    });
  };

  traverse(layers);
  return hiddenLayerMap;
}

/**
 * Check if a layer ID or any of its ancestors is in the selection path
 */
export function isLayerOrAncestorSelected(
  layerId: string,
  selectedLayerId: string | null,
  layers: Layer[]
): boolean {
  if (!selectedLayerId) return false;
  if (layerId === selectedLayerId) return true;

  // Check if selectedLayerId is a descendant of layerId
  const findLayerById = (layerList: Layer[], targetId: string): Layer | null => {
    for (const layer of layerList) {
      if (layer.id === targetId) return layer;
      if (layer.children) {
        const found = findLayerById(layer.children, targetId);
        if (found) return found;
      }
    }
    return null;
  };

  const isDescendant = (parentId: string, childId: string, layerList: Layer[]): boolean => {
    const parent = findLayerById(layerList, parentId);
    if (!parent || !parent.children) return false;

    const checkChildren = (children: Layer[]): boolean => {
      for (const child of children) {
        if (child.id === childId) return true;
        if (child.children && checkChildren(child.children)) return true;
      }
      return false;
    };

    return checkChildren(parent.children);
  };

  // Return true if selectedLayerId is a descendant of layerId
  return isDescendant(layerId, selectedLayerId, layers);
}

/**
 * Generate a media query for a set of breakpoints
 * Returns null if no restriction (all breakpoints), or the appropriate media query
 */
function getMediaQueryForBreakpoints(breakpoints: Breakpoint[] | undefined): string | null {
  // No restriction - apply to all breakpoints
  if (!breakpoints || breakpoints.length === 0 || breakpoints.length === 3) {
    return null;
  }

  const hasMobile = breakpoints.includes('mobile');
  const hasTablet = breakpoints.includes('tablet');
  const hasDesktop = breakpoints.includes('desktop');

  // Single breakpoint cases
  if (breakpoints.length === 1) {
    if (hasMobile) return '@media (max-width: 767px)';
    if (hasTablet) return '@media (min-width: 768px) and (max-width: 1023px)';
    if (hasDesktop) return '@media (min-width: 1024px)';
  }

  // Two breakpoint cases
  if (breakpoints.length === 2) {
    if (hasMobile && hasTablet) return '@media (max-width: 1023px)';
    if (hasTablet && hasDesktop) return '@media (min-width: 768px)';
    // Mobile + Desktop is a weird case - we'd need two separate rules
    // For now, return null and apply everywhere (better than breaking)
    if (hasMobile && hasDesktop) return null;
  }

  return null;
}

/**
 * Generate CSS for initial animation states (apply_styles: 'on-load')
 * This prevents flickering by applying styles server-side before JS loads.
 * Now checks per-property apply_styles on each tween.
 * Respects breakpoint restrictions on animations.
 */
export function generateInitialAnimationCSS(layers: Layer[]): InitialAnimationResult {
  const cssRules: string[] = [];
  const hiddenLayerInfo: HiddenLayerInfo[] = [];

  // Group rules by media query
  const rulesByMediaQuery = new Map<string | null, string[]>();

  // CSS rules for hidden elements via data attribute with breakpoint support
  // Global (all breakpoints)
  cssRules.push('[data-gsap-hidden=""] { display: none !important; }');
  // Per-breakpoint rules
  cssRules.push('@media (max-width: 767px) { [data-gsap-hidden~="mobile"] { display: none !important; } }');
  cssRules.push('@media (min-width: 768px) and (max-width: 1023px) { [data-gsap-hidden~="tablet"] { display: none !important; } }');
  cssRules.push('@media (min-width: 1024px) { [data-gsap-hidden~="desktop"] { display: none !important; } }');

  const collectStyles = (layerList: Layer[]) => {
    layerList.forEach((layer) => {
      if (layer.interactions) {
        layer.interactions.forEach((interaction) => {
          // Get the media query for this interaction's breakpoints
          const mediaQuery = getMediaQueryForBreakpoints(interaction.timeline?.breakpoints);
          const breakpointValue = interaction.timeline?.breakpoints?.join(' ') || null;

          (interaction.tweens || []).forEach((tween) => {
            // SplitText tweens target child elements (.word/.char/.line) created at
            // run-time, not the parent layer. Painting the `from` state on the parent
            // would offset/hide the whole element and never be cleared.
            if (tween.splitText) return;

            const styles: string[] = [];
            const transforms: string[] = [];
            const filterValues: Partial<Record<FilterPropertyKey, string>> = {};

            // Build CSS from 'from' properties whose effective apply mode is 'on-load'.
            // Intro triggers (load, scroll-into-view) are implicitly on-load to prevent flicker.
            PROPERTY_OPTIONS.forEach((opt) => {
              opt.properties.forEach((prop) => {
                if (getEffectiveApplyStyle(interaction.trigger, prop.key, tween.apply_styles) !== 'on-load') return;

                const value = tween.from[prop.key];
                if (value === null || value === undefined) return;

                const cssVal = resolveCssValue(value, prop);

                // Convert to CSS property - collect transforms separately to combine them
                if (prop.key === 'x') {
                  transforms.push(`translateX(${cssVal})`);
                } else if (prop.key === 'y') {
                  transforms.push(`translateY(${cssVal})`);
                } else if (prop.key === 'rotation') {
                  transforms.push(`rotate(${cssVal})`);
                } else if (prop.key === 'scale') {
                  transforms.push(`scale(${value})`);
                } else if (prop.key === 'skewX') {
                  transforms.push(`skewX(${cssVal})`);
                } else if (prop.key === 'skewY') {
                  transforms.push(`skewY(${cssVal})`);
                } else if (prop.key === 'autoAlpha') {
                  const opacity = Number(value) / 100;
                  styles.push(`opacity: ${opacity}`);
                  if (opacity === 0) {
                    styles.push(`visibility: hidden`);
                  }
                } else if (prop.key === 'width') {
                  styles.push(`width: ${cssVal}`);
                } else if (prop.key === 'height') {
                  styles.push(`height: ${cssVal}`);
                } else if (prop.key === 'backgroundColor') {
                  styles.push(`background-color: ${colorToCss(value)}`);
                } else if (isFilterPropertyKey(prop.key)) {
                  // Accumulate; combined into a single `filter` declaration below
                  filterValues[prop.key] = value;
                } else if (prop.key === 'display') {
                  // Track elements that should start hidden using data attribute
                  if (value === 'hidden') {
                    hiddenLayerInfo.push({
                      layerId: tween.layer_id,
                      breakpoints: breakpointValue,
                    });
                  }
                }
              });
            });

            // Combine all transforms into a single property
            if (transforms.length > 0) {
              styles.push(`transform: ${transforms.join(' ')}`);
            }

            // Combine accumulated filter sub-properties into a single CSS declaration
            const filterStr = buildFilterString(filterValues);
            if (filterStr !== null) {
              styles.push(`filter: ${filterStr}`);
            }

            if (styles.length > 0) {
              const rule = `[data-layer-id="${tween.layer_id}"] { ${styles.join('; ')}; }`;

              // Group by media query
              if (!rulesByMediaQuery.has(mediaQuery)) {
                rulesByMediaQuery.set(mediaQuery, []);
              }
              rulesByMediaQuery.get(mediaQuery)!.push(rule);
            }
          });
        });
      }

      if (layer.children) {
        collectStyles(layer.children);
      }
    });
  };

  collectStyles(layers);

  // Generate final CSS with media queries
  rulesByMediaQuery.forEach((rules, mediaQuery) => {
    if (mediaQuery) {
      // Wrap in media query
      cssRules.push(`${mediaQuery} { ${rules.join(' ')} }`);
    } else {
      // No media query - add directly
      cssRules.push(...rules);
    }
  });

  return { css: cssRules.join('\n'), hiddenLayerInfo };
}

export function buildGsapProps(tween: InteractionTween): GsapAnimationProps {
  const fromProps: Record<string, string | number> = {};
  const toProps: Record<string, string | number> = {};
  let displayStart: string | null = null;
  let displayEnd: string | null = null;

  PROPERTY_OPTIONS.forEach((opt) => {
    opt.properties.forEach((prop) => {
      // Handle display separately via data-gsap-hidden attribute
      if (prop.key === 'display') {
        displayStart = tween.from.display || 'visible';
        displayEnd = tween.to.display || 'visible';
        return;
      }

      // Filter sub-properties are combined into a single CSS `filter` string below
      if (isFilterPropertyKey(prop.key)) return;

      const fromVal = toGsapValue(tween.from[prop.key], prop);
      const toVal = toGsapValue(tween.to[prop.key], prop);

      if (fromVal !== undefined && fromVal !== null) {
        fromProps[prop.key] = fromVal;
      }
      if (toVal !== undefined && toVal !== null) {
        toProps[prop.key] = toVal;
      }
    });
  });

  // Combine filter sub-properties into a single CSS `filter` string so GSAP
  // can tween it as one property (otherwise multiple `filter` writes would
  // overwrite each other).
  const fromFilter = buildFilterString(tween.from);
  const toFilter = buildFilterString(tween.to);
  if (fromFilter !== null) fromProps.filter = fromFilter;
  if (toFilter !== null) toProps.filter = toFilter;

  return { from: fromProps, to: toProps, displayStart, displayEnd };
}

/** Minimum duration for GSAP tweens (0-duration causes issues) */
export function safeDuration(duration: number): number {
  return Math.max(duration, 0.001);
}

export interface SeparatedAnimationProps {
  fromTo: { from: Record<string, unknown>; to: Record<string, unknown> };
  fromOnly: Record<string, unknown>;
  toOnly: Record<string, unknown>;
  hasFromTo: boolean;
  hasFromOnly: boolean;
  hasToOnly: boolean;
}

/** Separates animation properties into fromTo, fromOnly, and toOnly groups */
export function separateAnimationProps(
  from: Record<string, unknown>,
  to: Record<string, unknown>
): SeparatedAnimationProps {
  const fromToFrom: Record<string, unknown> = {};
  const fromToTo: Record<string, unknown> = {};
  const fromOnly: Record<string, unknown> = {};
  const toOnly: Record<string, unknown> = {};

  const fromKeys = new Set(Object.keys(from));
  const toKeys = new Set(Object.keys(to));

  fromKeys.forEach((key) => {
    if (toKeys.has(key)) {
      fromToFrom[key] = from[key];
      fromToTo[key] = to[key];
    } else {
      fromOnly[key] = from[key];
    }
  });

  toKeys.forEach((key) => {
    if (!fromKeys.has(key)) {
      toOnly[key] = to[key];
    }
  });

  return {
    fromTo: { from: fromToFrom, to: fromToTo },
    fromOnly,
    toOnly,
    hasFromTo: Object.keys(fromToFrom).length > 0,
    hasFromOnly: Object.keys(fromOnly).length > 0,
    hasToOnly: Object.keys(toOnly).length > 0,
  };
}

export interface AddTweenOptions {
  element: HTMLElement;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
  duration: number;
  ease: string;
  position: number | string;
  onComplete?: () => void;
  splitText?: {
    type: 'chars' | 'words' | 'lines';
    stagger: { amount: number }; // GSAP stagger config
  };
  /** Pre-split elements from SplitText instance (chars, words, or lines array) */
  splitElements?: HTMLElement[];
}

/**
 * Updates a specific interaction in a list by ID
 */
export function updateInteractionById(
  interactions: import('@/types').LayerInteraction[],
  interactionId: string,
  updateFn: (interaction: import('@/types').LayerInteraction) => import('@/types').LayerInteraction
): import('@/types').LayerInteraction[] {
  return interactions.map((interaction) => {
    if (interaction.id !== interactionId) return interaction;
    return updateFn(interaction);
  });
}

/**
 * Updates tweens within a specific interaction
 */
export function updateInteractionTweens(
  interaction: import('@/types').LayerInteraction,
  updateFn: (tweens: import('@/types').LayerInteraction['tweens']) => import('@/types').LayerInteraction['tweens']
): import('@/types').LayerInteraction {
  return {
    ...interaction,
    tweens: updateFn(interaction.tweens),
  };
}

/**
 * Updates a specific tween within tweens array
 */
export function updateTweenById(
  tweens: import('@/types').LayerInteraction['tweens'],
  tweenId: string,
  updateFn: (tween: import('@/types').LayerInteraction['tweens'][number]) => import('@/types').LayerInteraction['tweens'][number]
): import('@/types').LayerInteraction['tweens'] {
  return tweens.map((tween) => {
    if (tween.id !== tweenId) return tween;
    return updateFn(tween);
  });
}

/** Adds a tween to a GSAP timeline, handling mixed from/to/fromTo properties */
export function addTweenToTimeline(
  timeline: gsap.core.Timeline,
  options: AddTweenOptions
): void {
  const { element, from, to, duration, ease, position, onComplete, splitText, splitElements: providedSplitElements } = options;
  const safeDur = safeDuration(duration);

  // If splitText is enabled, we need to target child elements created by GSAP's SplitText
  if (splitText) {
    // Use provided split elements if available, otherwise try to query by class
    let splitElements = providedSplitElements;

    if (!splitElements || splitElements.length === 0) {
      // Fallback: Try to find elements by class (GSAP SplitText creates these)
      const splitClass = splitText.type === 'chars' ? '.char' : splitText.type === 'words' ? '.word' : '.line';
      splitElements = Array.from(element.querySelectorAll(splitClass)) as HTMLElement[];
    }

    if (splitElements.length > 0) {
      const { fromTo, fromOnly, toOnly, hasFromTo, hasFromOnly, hasToOnly } = separateAnimationProps(from, to);

      // Use GSAP's stagger configuration directly
      // Can be a number (fixed delay) or { amount: duration } (total time to distribute)
      const staggerConfig = splitText.stagger;

      // Prevent immediate render for split text to avoid "from" state conflicts
      // when multiple tweens animate the same split elements in sequence
      const shouldDelayRender = position === '>' || position === '<' || (typeof position === 'number' && position > 0);

      if (hasFromTo) {
        timeline.fromTo(
          splitElements,
          fromTo.from,
          {
            ...fromTo.to,
            duration: safeDur,
            ease,
            stagger: staggerConfig,
            immediateRender: !shouldDelayRender,
            onComplete: !hasFromOnly && !hasToOnly ? onComplete : undefined
          },
          position
        );
      }

      if (hasFromOnly) {
        timeline.from(
          splitElements,
          {
            ...fromOnly,
            duration: safeDur,
            ease,
            stagger: staggerConfig,
            immediateRender: !shouldDelayRender && !hasFromTo,
            onComplete: !hasToOnly ? onComplete : undefined
          },
          hasFromTo ? '<' : position
        );
      }

      if (hasToOnly) {
        timeline.to(
          splitElements,
          {
            ...toOnly,
            duration: safeDur,
            ease,
            stagger: staggerConfig,
            onComplete
          },
          hasFromTo || hasFromOnly ? '<' : position
        );
      }
      return;
    }

    // If splitText is enabled but no split elements were found, fall back to regular animation
    // This can happen if the element has no text content or SplitText wasn't applied correctly
    console.warn(`SplitText enabled but no ${splitText.type} elements found for element:`, element);
  }

  // Regular animation without split text
  const { fromTo, fromOnly, toOnly, hasFromTo, hasFromOnly, hasToOnly } = separateAnimationProps(from, to);

  // Prevent immediate render to avoid "from" state conflicts in timelines
  const shouldDelayRender = position === '>' || position === '<' || (typeof position === 'number' && position > 0);

  // Add tweens - use '<' to run simultaneously with the first one
  if (hasFromTo) {
    timeline.fromTo(
      element,
      fromTo.from,
      {
        ...fromTo.to,
        duration: safeDur,
        ease,
        immediateRender: !shouldDelayRender,
        onComplete: !hasFromOnly && !hasToOnly ? onComplete : undefined
      },
      position
    );
  }

  if (hasFromOnly) {
    timeline.from(
      element,
      {
        ...fromOnly,
        duration: safeDur,
        ease,
        immediateRender: !shouldDelayRender && !hasFromTo,
        onComplete: !hasToOnly ? onComplete : undefined
      },
      hasFromTo ? '<' : position
    );
  }

  if (hasToOnly) {
    timeline.to(
      element,
      { ...toOnly, duration: safeDur, ease, onComplete },
      hasFromTo || hasFromOnly ? '<' : position
    );
  }

  // If no GSAP properties exist (e.g., display-only animation), add a minimal tween
  // to ensure the timeline has proper duration for callbacks (onStart, onReverseComplete)
  if (!hasFromTo && !hasFromOnly && !hasToOnly) {
    // Use a "to" tween with empty props - GSAP will wait for duration
    timeline.to(element, { duration: safeDur, onComplete }, position);
  }
}
