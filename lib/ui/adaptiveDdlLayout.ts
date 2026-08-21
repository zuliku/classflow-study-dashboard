export type DdlDensity = "compact" | "normal" | "spacious";

export interface AdaptiveDdlLayout {
  pageSize: number;
  density: DdlDensity;
}

/**
 * Pure deterministic adaptive layout for Upcoming DDL.
 * - availableHeight: list area height (container minus header/footer, px)
 * - itemCount: total upcoming items
 * Returns pageSize (1..5, or 0 if no items) and density.
 *
 * Card heights (approx visual):
 *  compact ~88px, normal ~106px, spacious ~122px, gap 8px
 */
export function resolveAdaptiveDdlLayout(input: { availableHeight: number; itemCount: number }): AdaptiveDdlLayout {
  const { availableHeight, itemCount } = input;
  if (itemCount <= 0) return { pageSize: 0, density: "normal" };
  if (availableHeight < 40) return { pageSize: 1, density: "compact" };

  const gap = 8;
  const hCompact = 88;
  const hNormal = 106;
  const hSpacious = 122;

  const capCompact = Math.floor((availableHeight + gap) / (hCompact + gap));
  const capNormal = Math.floor((availableHeight + gap) / (hNormal + gap));
  const capSpacious = Math.floor((availableHeight + gap) / (hSpacious + gap));

  const maxPage = 5;

  // If all items fit with spacious and space is abundant, use spacious
  const spaciousFit = Math.min(capSpacious, maxPage, itemCount);
  if (itemCount <= spaciousFit) {
    // Check if spacious truly fills without huge blank: if spaciousFit equals itemCount and availableHeight is enough
    // Use spacious when it can show all items without needing compact
    const neededSpacious = itemCount * hSpacious + (itemCount - 1) * gap;
    if (availableHeight >= neededSpacious - 10) {
      return { pageSize: itemCount, density: "spacious" };
    }
  }

  const normalFit = Math.max(1, Math.min(capNormal, maxPage, itemCount));
  const compactFit = Math.max(1, Math.min(capCompact, maxPage, itemCount));

  // If compact can fit more than normal and there are still items beyond normal, and remaining space is substantial, use compact
  if (compactFit > normalFit && itemCount > normalFit) {
    const usedNormal = normalFit * hNormal + (normalFit - 1) * gap;
    const remaining = availableHeight - usedNormal;
    // If remaining >= 40px (about half compact card), it's worth compacting to show one more
    if (remaining >= 40) {
      return { pageSize: compactFit, density: "compact" };
    }
  }

  // For very small availableHeight where normal would be tight, prefer compact
  if (availableHeight < hNormal + gap) {
    return { pageSize: Math.min(compactFit, itemCount), density: "compact" };
  }

  return { pageSize: normalFit, density: "normal" };
}
