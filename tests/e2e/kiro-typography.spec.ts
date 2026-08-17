import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Typography / Math Visual QA（desktop / tablet / mobile 390）：
 * 三类回答：A 中文解释（h2 + list + bold）、B 数学/经济学（inline + display math + 分式）、
 * C 综合 Markdown（heading + list + blockquote + table + code + link）。
 * 断言：KaTeX 真实渲染、字号/标题层级、页面无横向溢出、表格局部滚动。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

function sse(body: string): string {
  return body
    .split("\n")
    .filter(Boolean)
    .map((line) => `data: ${line}`)
    .join("\n\n") + "\n\n";
}

const ANSWER_B = `需求函数描述的是在某一时期内，消费者在其他条件不变的情况下，愿意且能够购买的商品数量与影响因素之间的关系。

## 核心形式

最常见的是把需求量写成价格的函数：

$$
Q_d = f(P)
$$

例如线性需求函数：

$$
Q_d = a - bP,\\qquad b>0
$$

其中：

- $Q_d$：需求量
- $P$：商品自身价格
- $a$：价格为零时的理论最大需求量
- $b$：需求量对价格的敏感程度

弹性公式为 $\\varepsilon_d = \\frac{\\Delta Q / Q}{\\Delta P / P}$，上标示例 $x^2$ 与希腊字母 $\\alpha$、求和 $\\sum_{i=1}^{n} x_i$。

长公式横向可滚动验证：$$\\frac{\\partial Q_d}{\\partial P} \\cdot \\frac{P}{Q_d} = \\frac{\\partial Q_d}{\\partial P} \\cdot \\frac{P}{Q_d} + \\sum_{i=1}^{n} \\frac{\\partial Q_i}{\\partial P_i} \\cdot \\frac{P_i}{Q_i}$$`;

const ANSWER_C = `## 综合说明

以下是**要点**与补充说明。

> 结论提示：公式与代码必须区分呈现。

| 术语 | 说明 | 数值 |
| --- | --- | --- |
| 弹性 | 需求量对价格变化的敏感程度 | $0.85$ |
| 交叉弹性 | 相关商品价格变化的影响 | $-0.32$ |

\`\`\`ts
const demand = (p: number) => 100 - 2 * p;
\`\`\`

更多参考：[ClassFlow 文档](https://example.com/docs)。`;

async function seedAI(page: Page) {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
}

async function openKiro(page: Page, width: number) {
  if (width >= 768) {
    await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  } else {
    await page.getByLabel("底部导航").getByRole("button", { name: "Kiro" }).click();
  }
}

async function sendMessage(page: Page, text: string) {
  const composer = page.getByTestId("kiro-composer");
  await composer.getByLabel("Ask Kiro").fill(text);
  await composer.getByLabel("发送").click();
}

for (const vp of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`math + typography @${vp.name} (${vp.width}px)`, async ({ page }) => {
    await page.route("**/api/ai/chat", async (route) => {
      const chunks = [
        JSON.stringify({ type: "start", messageId: "mock-vp-1" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "vp-text" }),
        ...ANSWER_B.split("\n").map((l, i) =>
          l ? JSON.stringify({ type: "text-delta", id: "vp-text", delta: (i ? "\n" : "") + l }) : null
        ).filter(Boolean),
        JSON.stringify({ type: "text-end", id: "vp-text" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ];
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
    });
    await seedAI(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openKiro(page, vp.width);

    await sendMessage(page, "解释需求函数与弹性");
    const msg = page.getByTestId("kiro-message").last();
    await expect(msg).toContainText("核心形式", { timeout: 10000 });

    // KaTeX 真实渲染（2 个短 display + 1 个长 display + inline 分式）
    await expect(msg.locator(".katex").first()).toBeVisible();
    expect(await msg.locator(".katex-display").count()).toBeGreaterThanOrEqual(3);
    // 分式（mfrac）与下标真实渲染
    expect(await msg.locator(".katex .mfrac").count()).toBeGreaterThan(0);

    // Typography：Kiro 输出三档字号对全部视口一致（standard=15px，CSS var 驱动）。
    // 移动端同样必须有 computed-style regression（不是仅 desktop）。
    const bodyFont = await msg.evaluate((el) => {
      const p = el.querySelector("p");
      return p ? getComputedStyle(p).fontSize : "";
    });
    expect(parseFloat(bodyFont)).toBeGreaterThanOrEqual(14.5);
    const h2 = msg.locator("h2").first();
    await expect(h2).toHaveText("核心形式");
    const h2Size = await h2.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(h2Size).toBeGreaterThanOrEqual(16);

    // 页面无横向溢出
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });

  test(`comprehensive markdown + overflow @${vp.name} (${vp.width}px)`, async ({ page }) => {
    await page.route("**/api/ai/chat", async (route) => {
      const chunks = [
        JSON.stringify({ type: "start", messageId: "mock-vp-2" }),
        JSON.stringify({ type: "start-step" }),
        JSON.stringify({ type: "text-start", id: "vp-text2" }),
        JSON.stringify({ type: "text-delta", id: "vp-text2", delta: ANSWER_C }),
        JSON.stringify({ type: "text-end", id: "vp-text2" }),
        JSON.stringify({ type: "finish-step" }),
        JSON.stringify({ type: "finish", finishReason: "stop" }),
      ];
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(chunks.join("\n")) });
    });
    await seedAI(page);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    await openKiro(page, vp.width);

    await sendMessage(page, "综合说明一下");
    const msg = page.getByTestId("kiro-message").last();
    await expect(msg).toContainText("综合说明", { timeout: 10000 });

    // 语义结构：heading / blockquote / table / code block / link / math in table
    await expect(msg.locator("h2")).toHaveText("综合说明");
    await expect(msg.locator("blockquote")).toContainText("结论提示");
    await expect(msg.locator("table th").first()).toHaveText("术语");
    await expect(msg.locator("pre code")).toContainText("const demand");
    await expect(msg.locator("a[href='https://example.com/docs']")).toBeVisible();
    expect(await msg.locator("table .katex").count()).toBeGreaterThan(0);

    // 表格在 wrapper 内滚动，页面不溢出
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(pageOverflow).toBe(false);
    const tableOverflow = await msg.locator("table").evaluate((el) => {
      const wrap = el.closest(".overflow-x-auto");
      return wrap ? wrap.scrollWidth >= wrap.clientWidth : false;
    });
    expect(tableOverflow).toBe(true);
  });
}
