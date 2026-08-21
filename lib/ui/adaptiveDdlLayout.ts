export type DdlDensity = "compact" | "normal" | "spacious";

export interface AdaptiveDdlLayout {
  pageSize: number;
  density: DdlDensity;
  cardHeight: number;
}

export const MAX_DDL_PAGE_SIZE = 4;
export const LIST_BREATHING_SPACE = 14;
export const MAX_CARD_HEIGHT = 104;

export const DDL_DENSITY_METRICS = {
  compact: { cardHeight: 64, gap: 6, padding: 8, dateTile: { w: 40, h: 48 } },
  normal: { cardHeight: 76, gap: 8, padding: 10, dateTile: { w: 46, h: 56 } },
  spacious: { cardHeight: 88, gap: 8, padding: 14, dateTile: { w: 52, h: 64 } },
} as const;

export function resolveAdaptiveDdlLayout(input: { availableHeight: number; itemCount: number }): AdaptiveDdlLayout {
  const { availableHeight, itemCount } = input;
  if (itemCount <= 0) return { pageSize: 0, density: "normal", cardHeight: DDL_DENSITY_METRICS.normal.cardHeight };
  if (availableHeight < 40) return { pageSize: 1, density: "compact", cardHeight: DDL_DENSITY_METRICS.compact.cardHeight };

  const gap = 8;
  const breathing = LIST_BREATHING_SPACE;

  // PageSize is capped at 4, based on minimal readable height (compact)
  const minCard = DDL_DENSITY_METRICS.compact.cardHeight;
  const maxVisibleByHeight = Math.max(1, Math.floor((availableHeight - breathing + gap) / (minCard + gap)));
  const pageSize = Math.min(maxVisibleByHeight, MAX_DDL_PAGE_SIZE, itemCount);

  // Determine density and adaptive cardHeight based on usable height
  const visibleCount = pageSize;
  const usableHeight = availableHeight - breathing - gap * Math.max(0, visibleCount - 1);
  const target = visibleCount > 0 ? usableHeight / visibleCount : DDL_DENSITY_METRICS.normal.cardHeight;

  let density: DdlDensity = "normal";
  let cardHeight: number;

  if (visibleCount <= 2) {
    // 1-2 cards: don't stretch huge, use spacious as ceiling, keep breathing
    const spaciousH = DDL_DENSITY_METRICS.spacious.cardHeight;
    if (target >= spaciousH) {
      density = "spacious";
      cardHeight = Math.min(target, MAX_CARD_HEIGHT);
      // If still huge remaining, cap at spacious and keep breathing (don't fill 100%)
      if (cardHeight > MAX_CARD_HEIGHT) cardHeight = MAX_CARD_HEIGHT;
      if (target > MAX_CARD_HEIGHT + 20) {
        // Keep spacious max, leave natural blank
        cardHeight = spaciousH;
        // If target is much larger, stay at spacious max
        if (target > spaciousH + 30) density = "spacious";
      }
    } else if (target >= DDL_DENSITY_METRICS.normal.cardHeight) {
      density = "normal";
      cardHeight = Math.min(target, MAX_CARD_HEIGHT);
    } else {
      density = "compact";
      cardHeight = Math.max(DDL_DENSITY_METRICS.compact.cardHeight, Math.min(target, MAX_CARD_HEIGHT));
    }
    // Hard cap for 1-2 cards to avoid giant
    cardHeight = Math.min(cardHeight, 96);
  } else {
    // 3-4 cards: adaptively stretch within reasonable bounds
    if (target < DDL_DENSITY_METRICS.compact.cardHeight) {
      density = "compact";
      cardHeight = DDL_DENSITY_METRICS.compact.cardHeight;
    } else if (target < DDL_DENSITY_METRICS.normal.cardHeight + 6) {
      density = "compact";
      cardHeight = Math.min(Math.max(target, DDL_DENSITY_METRICS.compact.cardHeight), MAX_CARD_HEIGHT);
      if (cardHeight >= 72) density = "normal";
    } else if (target < DDL_DENSITY_METRICS.spacious.cardHeight) {
      density = "normal";
      cardHeight = Math.min(target, MAX_CARD_HEIGHT);
    } else {
      density = "spacious";
      cardHeight = Math.min(target, MAX_CARD_HEIGHT);
    }
  }

  // Clamp overall
  cardHeight = Math.max(DDL_DENSITY_METRICS.compact.cardHeight, Math.min(cardHeight, MAX_CARD_HEIGHT));

  // If 1-2 cards and height would be huge, keep at spacious max and not fill
  if (visibleCount <= 2 && availableHeight > 400) {
    const spaciousMax = DDL_DENSITY_METRICS.spacious.cardHeight;
    if (cardHeight > spaciousMax) cardHeight = spaciousMax;
  }

  return { pageSize, density, cardHeight: Math.round(cardHeight) };
}
