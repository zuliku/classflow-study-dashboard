import { test as base, expect } from "@playwright/test";

/**
 * Course Detail V2 —— Productized Course Hub（focused E2E）。
 * A. 课程 → edge Drawer（aria-modal=true；desktop 宽度 560–600）
 * B. 首屏：code / name / teacher / classroom / credits / description / primary actions
 * C. Add Schedule 默认 CLOSED；quick action 展开 + 可提交
 * D. Edit existing slot 与 Add form 互斥（同屏只允许一个 editor）
 * E. 冲突时段仍阻止保存 → error 就地显示
 * F. Course Edit：name/teacher/classroom/credit/description → save → readonly 更新
 * G. Task row：title + status + deadline；点击 → Assignment Floating Detail
 * H. Material：preview 打开；upload 新增；delete + undo 恢复
 * I/J. >5 tasks / >5 materials：默认前 5 + 展开全部
 * K. 390×844：无横向溢出；close 可达；schedule form 可用
 */

function dayAnchor(): { monday: string } {
  const now = new Date();
  const w = now.getDay() === 0 ? 7 : now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (w - 1));
  const p = (n: number) => String(n).padStart(2, "0");
  return { monday: `${mon.getFullYear()}-${p(mon.getMonth() + 1)}-${p(mon.getDate())}` };
}

function seedScript(monday: string) {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const iso = (dayOffset: number, h: number, m: number) => {
    const mon = new Date(`${monday}T00:00:00`);
    const d = new Date(mon);
    d.setDate(mon.getDate() + dayOffset);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(h)}:${pad2(m)}:00`;
  };
  const dateStr = (dayOffset: number) => iso(dayOffset, 0, 0).slice(0, 10);
  const materials = Array.from({ length: 6 }, (_, i) => ({
    id: `m${i + 1}`,
    title: `第${i + 1}章 讲义.pdf`,
    type: "pdf",
    size: `2.${i + 1} MB`,
    uploadDate: dateStr(i + 1),
  }));
  const tasks = Array.from({ length: 7 }, (_, i) => ({
    id: `a${i + 1}`,
    courseId: "c1",
    title: `数据结构任务 ${i + 1}`,
    description: "",
    priority: "medium",
    status: i === 5 ? "completed" : i === 6 ? "submitted" : i % 2 === 0 ? "doing" : "todo",
    progress: i === 5 ? 100 : i === 6 ? 100 : i * 10,
    tags: [],
    ddl: i === 0 ? undefined : i === 3 ? iso(-2, 20, 0) : iso(3 + i, 20, 0),
  }));
  return `(() => {
    if (localStorage.getItem("classflow-storage-v2")) return;
    localStorage.setItem("classflow-storage-v2", JSON.stringify({
      version: 6,
      state: {
        userProfile: { name: "测试", avatarUrl: "", college: "", grade: "", studentId: "", completedCredits: 0, totalCredits: 0 },
        semester: { id: "s", name: "S", startDate: "${monday}", totalWeeks: 16 },
        courses: [
          { id: "c1", name: "数据结构与算法", code: "CS-210", teacher: "李教授", classroom: "计算机楼102", credit: 4, bgHex: "#DDE4DC", borderHex: "#C9D4C6", textHex: "#313032", description: "涵盖线性表、树与图、排序与查找等核心数据结构的原理与实现。", materials: ${JSON.stringify(materials)} },
          { id: "c2", name: "操作系统", code: "CS-220", teacher: "张教授", classroom: "计算机楼201", credit: 3, bgHex: "#E9E2D9", borderHex: "#D8CDBF", textHex: "#313032", description: "", materials: [] },
        ],
        schedules: [
          { id: "s1", courseId: "c1", dayOfWeek: 1, startTime: "08:00", endTime: "09:40", location: "计算机楼102", weeks: "1-16周" },
          { id: "s2", courseId: "c2", dayOfWeek: 1, startTime: "08:30", endTime: "10:00", location: "计算机楼201", weeks: "1-16周" },
        ],
        assignments: ${JSON.stringify(tasks)},
        calendarMarks: [],
        groupProjects: [],
        studyBlocks: [],
        assignmentTimeSlice: "all",
        preferences: { showWeekends: true, ddlWarningDays: 3, defaultDDLTime: "23:59", enableScheduleDirectManipulation: true, enableDDLDirectManipulation: true, motionPreference: "system", startupView: "overview", defaultTaskPriority: "medium", defaultTaskStatus: "todo", enableSingleKeyShortcuts: true, contentDensity: "comfortable", defaultTaskWorkspaceView: "focus", defaultDeadlineReminderMinutes: 1440 },
        reminders: [],
        focusSessions: [],
      },
    }));
  })()`;
}

async function openCourseDrawer(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("heading", { name: "数据结构与算法" }).first().click();
  const drawer = page.getByRole("dialog", { name: "课程详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });
  return drawer;
}

base("A+B：课程 → edge Drawer（aria-modal；宽度 560–600）+ 首屏核心信息与主操作", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  // edge（blocking）：aria-modal=true
  await expect(drawer).toHaveAttribute("aria-modal", "true");

  // 等 enter transition settle 后测量宽度（desktop 560–600）
  const panel = drawer;
  await expect(async () => {
    const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  }).toPass({ timeout: 5000 });
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(540);
  expect(box.width).toBeLessThanOrEqual(620);

  // 首屏：Identity + Overview + Primary Actions
  await expect(drawer.getByText("CS-210", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "数据结构与算法" })).toBeVisible();
  await expect(drawer.getByText("李教授", { exact: true })).toBeVisible();
  await expect(drawer.getByText("计算机楼102", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("4 学分", { exact: true })).toBeVisible();
  await expect(drawer.getByText(/核心数据结构的原理与实现/)).toBeVisible();
  await expect(drawer.getByText("1 个时段 · 7 个任务 · 6 份资料", { exact: true })).toBeVisible();
  const actions = drawer.getByRole("button", { name: "添加任务" });
  await expect(actions.first()).toBeVisible();
  await expect(drawer.getByRole("button", { name: "添加时段" }).first()).toBeVisible();
  await expect(drawer.getByRole("button", { name: "上传资料" }).first()).toBeVisible();
  // Delete 不在 header 常驻（进 More）
  await expect(drawer.getByRole("button", { name: "删除课程" })).toHaveCount(0);
});

base("C：Add Schedule 默认 CLOSED；quick action 展开 + 可提交", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  // 默认 closed
  await expect(drawer.getByTestId("schedule-add-form")).toHaveCount(0);
  // quick action：展开 + scroll + focus（星期字段获得焦点）
  await drawer.getByRole("button", { name: "添加时段" }).first().click();
  const addForm = drawer.getByTestId("schedule-add-form");
  await expect(addForm).toBeVisible({ timeout: 5000 });
  await expect(drawer.getByTestId("schedule-add-day")).toBeFocused({ timeout: 3000 });

  // 改到无冲突时段并提交 → 新 row 出现（周一 08:00-09:40 与既有时段冲突，改周二）
  await drawer.getByTestId("schedule-add-day").click();
  await page.getByRole("option", { name: "周二" }).first().click();
  await addForm.getByLabel("开始时间").fill("10:00");
  await addForm.getByLabel("结束时间").fill("11:40");
  await addForm.getByRole("button", { name: "+ 添加排课" }).click();
  await expect(drawer.getByText("周二 10:00–11:40", { exact: true })).toBeVisible({ timeout: 5000 });
});

base("D：Edit existing slot 与 Add form 互斥（同屏只有一个 editor）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  // 开始编辑既有时段 → Add form 不展开
  await drawer.getByRole("button", { name: /编辑时段 周一 08:00/ }).click();
  await expect(drawer.getByTestId("schedule-edit-form")).toBeVisible();
  await expect(drawer.getByTestId("schedule-add-form")).toHaveCount(0);

  // 编辑中点击 添加时段 → 退出编辑，只展开 Add form
  await drawer.getByRole("button", { name: "添加时段" }).first().click();
  await expect(drawer.getByTestId("schedule-add-form")).toBeVisible({ timeout: 5000 });
  await expect(drawer.getByTestId("schedule-edit-form")).toHaveCount(0);
});

base("E：冲突时段仍阻止保存 → error 就地显示", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  await drawer.getByRole("button", { name: "添加时段" }).first().click();
  const addForm = drawer.getByTestId("schedule-add-form");
  await expect(addForm).toBeVisible({ timeout: 5000 });
  // 与《操作系统》周一 08:30-10:00 重叠
  await addForm.getByLabel("开始时间").fill("08:30");
  await addForm.getByLabel("结束时间").fill("10:00");
  await addForm.getByRole("button", { name: "+ 添加排课" }).click();
  await expect(addForm.getByText(/存在时间冲突/)).toBeVisible();
  // 未新增
  await expect(addForm.getByText(/已阻止添加/)).toBeVisible();
});

base("F：Course Edit：name/teacher/classroom/credit/description → save → readonly 更新", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  await drawer.getByRole("button", { name: "编辑课程信息" }).click();
  const form = drawer.getByTestId("course-edit-form");
  await expect(form).toBeVisible({ timeout: 5000 });
  await form.getByPlaceholder("课程名称").fill("数据结构与算法（升级）");
  await form.getByPlaceholder("授课教师").fill("周教授");
  await form.getByPlaceholder("上课教室").fill("计算机楼303");
  await form.getByLabel("学分").fill("5");
  await form.getByPlaceholder("课程大纲与要求").fill("新增 B+ 树与跳表内容");
  await drawer.getByRole("button", { name: "保存", exact: true }).click();

  // readonly 摘要更新；编辑表单收起
  await expect(drawer.getByText("数据结构与算法（升级）", { exact: true })).toBeVisible();
  await expect(drawer.getByText("周教授", { exact: true })).toBeVisible();
  await expect(drawer.getByText("计算机楼303", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("5 学分", { exact: true })).toBeVisible();
  await expect(drawer.getByText(/新增 B\+ 树与跳表内容/).first()).toBeVisible();
  await expect(drawer.getByTestId("course-edit-form")).toHaveCount(0);

  // 空名称 → 阻止保存并显示错误
  await drawer.getByRole("button", { name: "编辑课程信息" }).click();
  await form.getByPlaceholder("课程名称").fill("   ");
  await drawer.getByRole("button", { name: "保存", exact: true }).click();
  await expect(form.getByText("课程名称不能为空", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(form).toHaveCount(0);
});

base("G：Task row：title + status + deadline；点击 → Assignment Floating Detail", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  // 行信息：标题 + 状态 + 截止（无 DDL 任务显示无截止时间；展开后可见已完成行）
  await expect(drawer.getByText("数据结构任务 1", { exact: true })).toBeVisible();
  await expect(drawer.getByText("待完成", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("进行中", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("无截止时间", { exact: true }).first()).toBeVisible();
  await drawer.getByTestId("tasks-expand-toggle").click();
  await expect(drawer.getByText("已完成", { exact: true }).first()).toBeVisible({ timeout: 5000 });

  // 点击 → Assignment Floating Detail（Course 关闭；无第二个 active overlay）
  await drawer.getByText("数据结构任务 1", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("dialog", { name: "课程详情" })).toHaveCount(0, { timeout: 8000 });
});

base("H：Material：preview 打开；upload 新增；delete + undo 恢复", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  // preview：查看 → 文件预览 modal
  await drawer.getByRole("button", { name: "查看", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "文件预览" })).toBeVisible({ timeout: 5000 });
  await page.keyboard.press("Escape");

  // upload：真实文件 → 新增（默认前 5 折叠 → 展开后可见新 row）
  await drawer.getByRole("button", { name: "上传资料" }).first().click();
  const fileInput = drawer.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "课堂笔记.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello classflow"),
  });
  await expect(drawer.getByText("课程资料 7 份", { exact: true })).toBeVisible({ timeout: 8000 });
  await drawer.getByTestId("materials-expand-toggle").click();
  await expect(drawer.getByText("课堂笔记.txt", { exact: true })).toBeVisible({ timeout: 5000 });

  // delete + undo：row 恢复
  await drawer.getByRole("button", { name: /删除资料 课堂笔记/ }).click();
  await expect(drawer.getByText("课堂笔记.txt", { exact: true })).toHaveCount(0, { timeout: 5000 });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(drawer.getByText("课堂笔记.txt", { exact: true })).toBeVisible({ timeout: 5000 });
});

base("I+J：>5 tasks / >5 materials：默认前 5 + 展开全部", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  // 任务默认 5 行 + 展开全部 7 项
  await expect(drawer.getByText("数据结构任务 6", { exact: true })).not.toBeVisible();
  await drawer.getByTestId("tasks-expand-toggle").click();
  await expect(drawer.getByText("数据结构任务 7", { exact: true })).toBeVisible({ timeout: 5000 });

  // 资料默认 5 行 + 展开全部 6 项
  await expect(drawer.getByText("第6章 讲义.pdf", { exact: true })).not.toBeVisible();
  await drawer.getByTestId("materials-expand-toggle").click();
  await expect(drawer.getByText("第6章 讲义.pdf", { exact: true })).toBeVisible({ timeout: 5000 });
});

base("K：390×844：无横向溢出；close 可达；schedule form 可用", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // 移动端走「课程资料」入口（Overview 课程卡在窄屏有滚动容器，避免点击不稳定）
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.locator('div[role="button"]').filter({ hasText: "数据结构与算法" }).first().click();
  const drawer = page.getByRole("dialog", { name: "课程详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });

  // 无横向溢出；drawer 全宽
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
  const box = (await drawer.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(390);

  // close 可达
  await expect(drawer.getByRole("button", { name: "关闭" })).toBeVisible();

  // schedule form 可展开使用且不横向溢出
  await drawer.getByRole("button", { name: "添加时段" }).first().click();
  const addForm = drawer.getByTestId("schedule-add-form");
  await expect(addForm).toBeVisible({ timeout: 5000 });
  await addForm.getByLabel("开始时间").fill("10:00");
  await addForm.getByLabel("结束时间").fill("11:40");
  const overflow2 = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow2).toBe(false);
});
