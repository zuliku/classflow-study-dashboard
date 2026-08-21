export type DdlDensity = "compact" | "normal" | "spacious";

export interface AdaptiveDdlLayout {
  pageSize: number;
  density: DdlDensity;
}

/**
 * Unified metrics — resolver and renderer share same heights.
 * Real renderer (UpcomingDDL Card): compact ~64, normal ~76, spacious ~88
 */
export const DDL_DENSITY_METRICS = {
  compact: { cardHeight: 64, gap: 6, padding: 8, dateTile: { w: 40, h: 48 } },
  normal: { cardHeight: 76, gap: 8, padding: 10, dateTile: { w: 46, h: 56 } },
  spacious: { cardHeight: 88, gap: 8, padding: 14, dateTile: { w: 52, h: 64 } },
} as const;

export function resolveAdaptiveDdlLayout(input: { availableHeight: number; itemCount: number }): AdaptiveDdlLayout {
  const { availableHeight, itemCount } = input;
  if (itemCount <= 0) return { pageSize: 0, density: "normal" };
  if (availableHeight < 40) return { pageSize: 1, density: "compact" };

  const { compact, normal, spacious } = DDL_DENSITY_METRICS;

  const cap = (h: number, g: number) => Math.floor((availableHeight + g) / (h + g));
  const capCompact = cap(compact.cardHeight, compact.gap);
  const capNormal = cap(normal.cardHeight, normal.gap);
  const capSpacious = cap(spacious.cardHeight, spacious.gap);

  // No fixed maxPage — pageSize fully determined by availableHeight + minimal readable height
  // Try to fit all items with spacious when abundant
  const spaciousFit = Math.min(capSpacious, itemCount);
  if (itemCount <= spaciousFit) {
    const neededSpacious = itemCount * spacious.cardHeight + (itemCount - 1) * spacious.gap;
    if (availableHeight >= neededSpacious - 8) {
      return { pageSize: itemCount, density: "spacious" };
    }
  }

  const normalFit = Math.max(1, Math.min(capNormal, itemCount));
  const compactFit = Math.max(1, Math.min(capCompact, itemCount));

  // If compact can show at least one more than normal, prefer compact to avoid blank page
  if (compactFit > normalFit && itemCount > normalFit) {
    const usedNormal = normalFit * normal.cardHeight + (normalFit - 1) * normal.gap;
    const remaining = availableHeight - usedNormal;
    // If remaining can accommodate compact's extra card (with compact gap) or is sizable, use compact
    if (remaining >= 20 || compactFit > normalFit) {
      // Ensure compact actually fits at least one more
      if (compactFit >= normalFit + 1) {
        return { pageSize: compactFit, density: "compact" };
      }
    }
  }

  // For very tight height, compact is more readable than clipping normal
  if (availableHeight < normal.cardHeight + normal.gap) {
    return { pageSize: Math.min(compactFit, itemCount), density: "compact" };
  }

  return { pageSize: normalFit, density: "normal" };
}
