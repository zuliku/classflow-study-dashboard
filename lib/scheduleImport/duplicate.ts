/**
 * 导入重复课程检测（共享）。
 * 优先可信 course code；没有可信 code 时按 name + teacher。
 */
export function isReliableCode(code: string | null | undefined): boolean {
  return typeof code === "string" && code.trim().length > 0 && !/^(ICS|JSON|CSV)-\d+$/.test(code.trim());
}

export interface ImportDuplicateCandidate {
  name: string;
  code?: string | null;
  teacher?: string | null;
}

/**
 * 查找与草稿重复的已有课程（本次导入内的其它课程也可作为候选）。
 * 返回匹配到的候选，否则 null。
 */
export function findImportDuplicateCourse(
  draft: ImportDuplicateCandidate,
  candidates: ImportDuplicateCandidate[]
): ImportDuplicateCandidate | null {
  if (isReliableCode(draft.code)) {
    const byCode = candidates.find(
      (c) => isReliableCode(c.code) && c.code!.trim() === draft.code!.trim()
    );
    if (byCode) return byCode;
  }
  return (
    candidates.find(
      (c) =>
        c.name === draft.name &&
        (c.teacher ?? "") === (draft.teacher ?? "")
    ) ?? null
  );
}
