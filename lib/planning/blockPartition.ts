/**
 * Remainder-Aware StudyBlock Duration Partition（V1.3）。
 * 纯函数：把需求分钟精确切成 ≤90min 的块序列。
 * - sum(partition) === minutes（绝不 overshoot / undershoot）
 * - 每个 duration > 0 且 <= preferredMax（默认 90）
 * - 连续容量充足且 minutes >= preferredMin 时，尽量保证每块 >= preferredMin（remainder-aware）
 * - 短任务（< preferredMin）→ 单块原值（20min 就是 20min，不强行 30）
 */

export interface PartitionOptions {
  preferredMin?: number;
  preferredMax?: number;
}

export function partitionStudyDuration(
  minutes: number,
  options?: PartitionOptions
): number[] {
  const preferredMin = options?.preferredMin ?? 30;
  const preferredMax = options?.preferredMax ?? 90;
  if (minutes <= 0) return [];
  if (minutes <= preferredMax) return [minutes];

  const out: number[] = [];
  let remaining = minutes;
  while (remaining > preferredMax) {
    // 给剩余部分至少留下 preferredMin（除非数学上不可能——remaining 本身已 > max 时恒可能）
    const take = Math.min(preferredMax, remaining - preferredMin);
    out.push(take);
    remaining -= take;
  }
  if (remaining > 0) out.push(remaining);
  return out;
}

/** Block 的墙钟时长（分钟）；start/end "HH:mm" */
export function blockDurationMinutes(block: { startTime: string; endTime: string }): number {
  const [sh, sm] = block.startTime.split(":").map(Number);
  const [eh, em] = block.endTime.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}
