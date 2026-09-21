/**
 * Computer Use V2.1 — Vision 候选 ↔ UIA 元素关联（IoU 匹配）。
 *
 * 背景（参考 Agent S：截图用于看状态，accessibility tree 用于 grounding）：
 * 视觉模型只输出归一化候选区域；若候选与某个已观察控件高度重叠，
 * 则直接携带该控件的 elementId —— 后续动作可走 UIA 语义路径，
 * 不必用坐标回退（也就不会每次都触发审批）。
 */

export interface VisionRegionInput {
  label: string;
  confidence: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface MatchableElement {
  elementId: string;
  role: string;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface VisionRegionMatched extends VisionRegionInput {
  elementId?: string;
  role?: string;
  name?: string;
  iou?: number;
}

export const VISION_ELEMENT_MIN_IOU = 0.3;

/** 归一化候选 → 像素区域（observation viewport 为基准） */
export function regionToPixels(
  region: VisionRegionInput,
  viewport: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  return {
    x: region.bounds.x * viewport.width,
    y: region.bounds.y * viewport.height,
    width: region.bounds.width * viewport.width,
    height: region.bounds.height * viewport.height,
  };
}

/** IoU（无交集 → 0；任一面积为 0 → 0） */
export function intersectionOverUnion(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): number {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return 0;
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const interW = right - left;
  const interH = bottom - top;
  if (interW <= 0 || interH <= 0) return 0;
  const inter = interW * interH;
  const union = a.width * a.height + b.width * b.height - inter;
  return union <= 0 ? 0 : inter / union;
}

function centerInside(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  return cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height;
}

/**
 * 为每个视觉候选寻找最佳匹配控件：
 * 1. IoU ≥ minIoU → 关联
 * 2. 否则候选中心落在控件内 → 关联（记录 iou）
 * 3. 都不满足 → 保持无 elementId（坐标回退，仍需审批）
 */
export function associateVisionCandidates(
  candidates: readonly VisionRegionInput[],
  elements: readonly MatchableElement[],
  viewport: { width: number; height: number },
  options?: { minIoU?: number }
): VisionRegionMatched[] {
  const minIoU = options?.minIoU ?? VISION_ELEMENT_MIN_IOU;
  return candidates.map((candidate) => {
    const pixels = regionToPixels(candidate, viewport);
    let best: { element: MatchableElement; iou: number } | null = null;
    for (const element of elements) {
      const iou = intersectionOverUnion(pixels, element.bounds);
      if (!best || iou > best.iou) best = { element, iou };
    }
    if (best && best.iou >= minIoU) {
      return {
        ...candidate,
        elementId: best.element.elementId,
        role: best.element.role,
        name: best.element.name,
        iou: Math.round(best.iou * 100) / 100,
      };
    }
    if (best && centerInside(pixels, best.element.bounds)) {
      return {
        ...candidate,
        elementId: best.element.elementId,
        role: best.element.role,
        name: best.element.name,
        iou: Math.round(best.iou * 100) / 100,
      };
    }
    return { ...candidate };
  });
}
