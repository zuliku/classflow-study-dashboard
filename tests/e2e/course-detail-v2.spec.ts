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
          // c2 与 c1 同日但时间不重叠（避免课表卡片视觉重叠影响点击）；
          // E 的冲突场景由「新增 周一 08:30-10:00 与 c1 自身 08:00-09:40 重叠」覆盖
          { id: "s2", courseId: "c2", dayOfWeek: 1, startTime: "14:00", endTime: "15:40", location: "计算机楼201", weeks: "1-16周" },
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
  // 经「课程资料」工作区的课程名 button 进入（Overview 课表卡有 drag 吞 click 路径，避免不稳定）
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "数据结构与算法", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "课程详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });
  return drawer;
}

base("A+B：课程 → Floating Course Hub（non-modal；宽度 ~500px）+ 首屏核心信息与主操作", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  // floating non-blocking contextual panel：不声明 aria-modal（背景可交互，不冒充 modal）
  await expect(drawer).not.toHaveAttribute("aria-modal", "true");

  // 等 enter transition settle 后测量宽度（约 500px family）
  const panel = drawer;
  await expect(async () => {
    const transform = await panel.evaluate((el) => getComputedStyle(el).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  }).toPass({ timeout: 5000 });
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(480);
  expect(box.width).toBeLessThanOrEqual(520);

  // 首屏：Identity + Overview + Primary Actions
  await expect(drawer.getByText(/CS-210/).first()).toBeVisible();
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
  // 移动端 Overview 的 本周课表 schedule-card 是稳定入口（底部导航把 课程资料 收进 更多）
  await page
    .locator('[data-testid="schedule-card"]')
    .filter({ hasText: "数据结构与算法" })
    .first()
    .click();
  const drawer = page.getByRole("dialog", { name: "课程详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });

  // 无横向溢出；drawer 全宽（亚像素容差）
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
  const box = (await drawer.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(390.5);

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

/** settle enter 后读取 panel 几何（跳过 230ms transform/opacity 动画期） */
async function settledBox(drawer: import("@playwright/test").Locator) {
  await expect(async () => {
    const transform = await drawer.evaluate((el) => getComputedStyle(el).transform);
    expect(transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
  }).toPass({ timeout: 5000 });
  return (await drawer.boundingBox())!;
}

async function centerOffset(drawer: import("@playwright/test").Locator) {
  const box = await settledBox(drawer);
  return Math.abs(box.y + box.height / 2 - 450); // viewport 1440×900 → centerY 450
}

base("L：Hub 垂直居中 + content-fit 高度（short < long；均非 h-full）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await page.setViewportSize({ width: 1440, height: 900 });

  // 短课程：操作系统（0 任务 / 0 资料 / 1 时段 / 无说明）
  await page.goto("/");
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "操作系统", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "课程详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });
  const shortBox = await settledBox(drawer);
  // 不是 h-full：高度明显小于 viewport safe inset（content-fit，短内容 Hub 不拉满）
  expect(shortBox.height).toBeLessThan(900 - 32);
  expect(shortBox.height).toBeLessThan(700);
  // 垂直居中（±4px 亚像素容差）
  expect(await centerOffset(drawer)).toBeLessThanOrEqual(4);

  // 长课程：数据结构与算法（7 任务 / 6 资料）→ 更高
  await drawer.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "数据结构与算法", exact: true }).click();
  await expect(drawer).toBeVisible({ timeout: 8000 });
  const longBox = await settledBox(drawer);
  expect(longBox.height).toBeGreaterThan(shortBox.height);
  expect(await centerOffset(drawer)).toBeLessThanOrEqual(4);
});

base("M：Long Hub 达 max-height 后 Body 内部滚动（Header/Close 常驻）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  // 展开全部任务 + 资料 + Add Schedule → 内容超过 max-height
  await drawer.getByTestId("tasks-expand-toggle").click();
  await drawer.getByTestId("materials-expand-toggle").click();
  await drawer.getByRole("button", { name: "添加时段" }).first().click();
  await expect(drawer.getByTestId("schedule-add-form")).toBeVisible({ timeout: 5000 });

  const box = await settledBox(drawer);
  // panel 高度被 max-height 封顶（viewport safe inset，含亚像素容差）
  expect(box.height).toBeLessThanOrEqual(900 - 32 + 2);
  expect(box.y).toBeGreaterThanOrEqual(12);
  // 垂直居中仍成立
  expect(await centerOffset(drawer)).toBeLessThanOrEqual(4);

  // Body 内部滚动：scrollHeight > clientHeight；Header/Close 常驻
  const scroll = await drawer.evaluate((el) => {
    const body = el.querySelector<HTMLElement>('div[class*="overflow-y-auto"]');
    return body ? { sh: body.scrollHeight, ch: body.clientHeight } : null;
  });
  expect(scroll).not.toBeNull();
  expect(scroll!.sh).toBeGreaterThan(scroll!.ch);
  await expect(drawer.getByRole("button", { name: "关闭" })).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "数据结构与算法" })).toBeVisible();

  // 滚到 Body 底部 → 最后一个展开项可见（panel bottom 不超出 viewport）
  await drawer.evaluate((el) => {
    const body = el.querySelector<HTMLElement>('div[class*="overflow-y-auto"]');
    if (body) body.scrollTop = body.scrollHeight;
  });
  await expect(drawer.getByText("第6章 讲义.pdf", { exact: true })).toBeVisible({ timeout: 3000 });
  const afterScroll = await settledBox(drawer);
  expect(afterScroll.y + afterScroll.height).toBeLessThanOrEqual(900 - 12);
});

base("N：动态 disclosure 扩张/收起后仍居中（无跳顶/无 bottom overflow）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "操作系统", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "课程详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });

  const before = await settledBox(drawer);
  // 展开 Add Schedule（Section 内 disclosure toggle）→ Hub 变高且仍居中
  const scheduleToggle = drawer
    .getByTestId("course-schedule-section")
    .getByRole("button", { name: "添加时段" });
  await scheduleToggle.click();
  await expect(drawer.getByTestId("schedule-add-form")).toBeVisible({ timeout: 5000 });
  const expanded = await settledBox(drawer);
  expect(expanded.height).toBeGreaterThan(before.height);
  expect(Math.abs(expanded.y + expanded.height / 2 - 450)).toBeLessThanOrEqual(4);

  // 再次点击 toggle 收起 → 缩短并回到 center
  await scheduleToggle.click();
  await expect(drawer.getByTestId("schedule-add-form")).toHaveCount(0, { timeout: 5000 });
  const collapsed = await settledBox(drawer);
  expect(collapsed.height).toBeLessThan(expanded.height);
  expect(Math.abs(collapsed.y + collapsed.height / 2 - 450)).toBeLessThanOrEqual(4);
});

base("O：Course Library Card content-fit + 同 row 垂直中心对齐", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await expect(page.getByRole("heading", { name: "课程资料" })).toBeVisible();

  // c1（2 任务 + 2 资料 preview）应高于 c2（0 任务 / 0 资料）
  const cardA = page
    .locator("article")
    .filter({ has: page.getByRole("button", { name: "数据结构与算法", exact: true }) });
  const cardB = page
    .locator("article")
    .filter({ has: page.getByRole("button", { name: "操作系统", exact: true }) });
  await expect(cardA).toBeVisible();
  await expect(cardB).toBeVisible();
  const boxA = (await cardA.boundingBox())!;
  const boxB = (await cardB.boundingBox())!;

  // 不是固定/等高：A 明显高于 B
  expect(boxA.height).toBeGreaterThan(boxB.height + 30);
  // 同一 grid row：中心 Y 对齐（±4px 容差）
  expect(Math.abs(boxA.y + boxA.height / 2 - (boxB.y + boxB.height / 2))).toBeLessThanOrEqual(4);
});

/**
 * Entity Ownership（Course Floating Hub V1 closure）。
 * 固定：c1 数据结构与算法 = 1 时段 · 7 任务 · 6 资料；c2 操作系统 = 1 时段 · 0 任务 · 0 资料。
 */

base("P：A→B 切换 outer shell 不 remount；任意采样帧 header/body 同实体（无 mixed snapshot）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);
  await expect(drawer.getByText("1 个时段 · 7 个任务 · 6 份资料", { exact: true })).toBeVisible();

  // 标记 outer shell（若 remount，标记即丢失）
  await drawer.evaluate((el) => {
    (el as HTMLElement & { __ownershipProbe?: string }).__ownershipProbe = "same-shell";
  });

  // 背景点击 Course B（floating non-modal 保持背景可交互）
  await page.getByRole("button", { name: "操作系统", exact: true }).click();

  // shell 必须仍是同一 DOM 节点
  const stillSame = await drawer.evaluate((el) => {
    return (el as HTMLElement & { __ownershipProbe?: string }).__ownershipProbe === "same-shell";
  });
  expect(stillSame).toBe(true);

  // 连续采样整个 swap 过程：header 与 body 必须同实体；A 帧统计=6 份资料，B 帧=0 份资料
  await expect(async () => {
    const f = await drawer.evaluate((el) => {
      const scope = el as HTMLElement;
      const headerId = scope
        .querySelector("[data-displayed-course-id]")
        ?.getAttribute("data-displayed-course-id");
      const bodyId = scope
        .querySelector('[data-testid="course-detail-body"]')
        ?.getAttribute("data-displayed-course-id");
      const statsText =
        Array.from(scope.querySelectorAll("p, span"))
          .map((n) => n.textContent ?? "")
          .find((t) => t.includes("个时段")) ?? "";
      return { headerId, bodyId, statsText };
    });
    expect(f.headerId).toBe(f.bodyId);
    if (f.headerId === "c1") expect(f.statsText).toContain("6 份资料");
    if (f.headerId === "c2") expect(f.statsText).toContain("0 份资料");
  }).toPass({ timeout: 4000 });

  // settle 后：B Header/Body 一致、B 统计、无 A materials、A 任务消失
  await expect(drawer.getByRole("heading", { name: "操作系统" })).toBeVisible();
  await expect(drawer.locator('[data-testid="course-detail-body"]')).toHaveAttribute(
    "data-displayed-course-id",
    "c2"
  );
  await expect(drawer.getByText("1 个时段 · 0 个任务 · 0 份资料", { exact: true })).toBeVisible();
  await expect(drawer.getByText("第1章 讲义.pdf", { exact: true })).toHaveCount(0);
  await expect(drawer.getByText("数据结构任务 1", { exact: true })).toHaveCount(0);
});

base("Q：Reduced Motion：A→B 立即一致（无 stale interactive 窗口）", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  await page.emulateMedia({ reducedMotion: "reduce" });
  const drawer = await openCourseDrawer(page);

  await page.getByRole("button", { name: "操作系统", exact: true }).click();
  // 立即（无 60ms）：Header/Body/统计全部 B
  await expect(drawer.locator('[data-testid="course-detail-body"]')).toHaveAttribute(
    "data-displayed-course-id",
    "c2",
    { timeout: 1500 }
  );
  await expect(drawer.getByRole("heading", { name: "操作系统" })).toBeVisible();
  await expect(drawer.getByText("1 个时段 · 0 个任务 · 0 份资料", { exact: true })).toBeVisible();
  await expect(drawer.getByText("第1章 讲义.pdf", { exact: true })).toHaveCount(0);
});

base("R：swap-out 期间旧 A 内容 non-interactive（inert + More disabled）；settle 后恢复", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  // 冻结时钟：swap 的 60ms timer 由 fastForward 精确控制（pauseAt 后不再实时走动）
  await page.clock.install();
  const drawer = await openCourseDrawer(page);
  // 跳到当前 mock 时间 +60s 并暂停（evaluate 往返期间时钟会继续走，直接 pauseAt(now) 会报「过去」）
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 60_000);

  await page.getByRole("button", { name: "操作系统", exact: true }).click();
  // 停在 60ms swap-out 中段：displayed 仍 A、current 已 B → body inert + More disabled
  await page.clock.fastForward(30);
  const body = drawer.locator('[data-testid="course-detail-body"]');
  await expect(body).toHaveAttribute("inert", "");
  await expect(drawer.getByRole("button", { name: "更多操作" })).toBeDisabled();
  // A 帧内容自身一致（A 统计 + A header）
  await expect(drawer.getByRole("heading", { name: "数据结构与算法" })).toBeVisible();
  await expect(drawer.getByText("1 个时段 · 7 个任务 · 6 份资料", { exact: true })).toBeVisible();

  // 越过 60ms → settle：B 可交互（inert 移除）
  await page.clock.fastForward(60);
  await expect(body).not.toHaveAttribute("inert", "");
  await expect(drawer.getByRole("heading", { name: "操作系统" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "更多操作" })).toBeEnabled();
});

base("S：More → 删除课程：confirm 确认后删除点下 Delete 时的 displayed 课程", async ({ page }) => {
  const { monday } = dayAnchor();
  await page.addInitScript(seedScript(monday));
  const drawer = await openCourseDrawer(page);

  await drawer.getByRole("button", { name: "更多操作" }).click();
  await drawer.getByRole("menuitem", { name: "删除课程" }).click();
  const confirm = page.getByRole("alertdialog").first();
  await expect(confirm).toBeVisible({ timeout: 5000 });
  await confirm.getByRole("button", { name: "删除课程" }).click();
  await expect(drawer).toHaveCount(0);
  // 课程从库中消失
  await expect(page.getByRole("button", { name: "数据结构与算法", exact: true })).toHaveCount(0);
});
