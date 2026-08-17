/**
 * Learning History Clear / Reset（Part 1）：
 * - clearLearningHistoryForUser：清空 + focusBackfillDisabled=true（Part 2 Settings 直接调用）
 * - resetLearningHistoryForDomainReset：clearLearningData / resetEntireApp / restoreAppData 用
 *   （新 historyStartedAt + 允许 Focus backfill）
 */

import {
  clearLearningHistoryForUser as clearStoreForUser,
  resetLearningHistoryCoverage,
} from "@/lib/history/store";
import { enqueueLearningHistoryReset } from "@/lib/history/recorder";

/** 用户主动清空 History（阻止再次回填旧 Focus） */
export function clearLearningHistoryForUser(): void {
  enqueueLearningHistoryReset(async () => {
    await clearStoreForUser();
  });
}

/** 业务数据整体重置（clearLearningData / resetEntireApp / restoreAppData） */
export function resetLearningHistoryForDomainReset(): void {
  enqueueLearningHistoryReset(async () => {
    await resetLearningHistoryCoverage();
  });
}
