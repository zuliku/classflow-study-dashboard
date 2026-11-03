import { test as base, Page } from "@playwright/test";
import {
  initialUserProfile,
  initialCourses,
  initialSchedules,
  initialAssignments,
  initialCalendarMarks,
  initialGroupProjects,
} from "../../lib/mockData";
import { DEFAULT_PREFERENCES } from "../../lib/preferences";

/** 与生产 createDefaultSemester 一致的动态学期（本周一开学，第 1 周即本周） */
function defaultSemesterState() {
  const now = new Date();
  const dow = now.getDay() === 0 ? 7 : now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow - 1));
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return {
    id: "sem_e2e",
    name: "E2E学期",
    startDate: `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`,
    totalWeeks: 16,
  };
}

/** node 侧计算相对今天（零点）的天偏移，供页面内按浏览器时间重建日期（消除跨天 flaky） */
function dayOffsetFromDateStr(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today0.getTime()) / 86400000);
}

async function seedDemoStorage(page: Page) {
  // 计算相对偏移：assignments 用 ddl 日期；calendarMarks 用 date
  const assignmentsWithOffset = initialAssignments.map((a) => ({
    ...a,
    __dayOffset: dayOffsetFromDateStr((a.ddl ?? "").slice(0, 10)),
  }));
  const marksWithOffset = initialCalendarMarks.map((m) => ({
    ...m,
    __dayOffset: dayOffsetFromDateStr(m.date),
  }));

  await page.addInitScript(
    ({ state, version }) => {
      // 只在首次导航注入；reload 后保留 persist 写入的真实状态
      if (!localStorage.getItem("classflow-storage-v2")) {
        const localDateStr = (d: Date) => {
          const pad2 = (n: number) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        };
        const shift = (offset: number) => {
          const d = new Date();
          d.setDate(d.getDate() + offset);
          return localDateStr(d);
        };
        const assignments = state.assignments.map((a: any) => {
          const time = /T(\d{2}:\d{2})/.exec(a.ddl)?.[1] ?? "23:59";
          return { ...a, ddl: `${shift(a.__dayOffset)}T${time}:00` };
        });
        const calendarMarks = state.calendarMarks.map((m: any) => ({
          ...m,
          date: shift(m.__dayOffset),
        }));
        localStorage.setItem(
          "classflow-storage-v2",
          JSON.stringify({
            version,
            state: { ...state, assignments, calendarMarks },
          })
        );
      }
    },
    {
      // 与 store 当前 persist version 保持一致（v7：Schedule Occurrence Override；旧值会被丢弃 → First Run）
      version: 7,
      state: {
        userProfile: initialUserProfile,
        courses: initialCourses,
        schedules: initialSchedules,
        assignments: assignmentsWithOffset,
        calendarMarks: marksWithOffset,
        groupProjects: initialGroupProjects,
        semester: defaultSemesterState(),
        assignmentTimeSlice: "all",
        preferences: DEFAULT_PREFERENCES,
      },
    }
  );
}

export const test = base.extend({
  page: async ({ page }, use) => {
    // Task-12：本地发送需要 Electron preload 的 invocation capability；
    // Chromium E2E 无 preload，注入最小本地 stub（不改变生产鉴权）。
    await page.addInitScript(() => {
      const w = window as unknown as {
        classflowDesktop?: { invocation?: { beginLocal: () => Promise<{ invocationId: string }> } };
      };
      if (!w.classflowDesktop) w.classflowDesktop = {};
      if (!w.classflowDesktop.invocation) {
        let seq = 0;
        w.classflowDesktop.invocation = {
          beginLocal: async () => ({ invocationId: `inv_e2e_${++seq}_00000000-0000-4000-8000-000000000000` }),
        };
      }
    });
    await seedDemoStorage(page);
    await use(page);
  },
});
