import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";
import http from "node:http";

/**
 * Kiro Streaming UX V4.7.2：Tool continuation latency 定标（25 次 deterministic local loop）。
 *
 * V4.7.2 benchmark validity：
 * - 无永久 rAF polling / setInterval polling —— MutationObserver 是唯一 DOM detection owner，
 *   且只 observe [data-testid="kiro-conversation"]（先等 container 出现，再 attach）。
 * - 每个 Turn 唯一 marker：CAL_TOOL_{i} / CAL_FINAL_{i}；messageId = cal-{i}（data-message-id 静态 metadata）。
 * - marker 精确绑定当前 Assistant Turn：mutation → closest([data-message-id]) → 只检查该 message 局部状态。
 * - request / marker 以 `${turnIndex}:${stage}` 显式配对；重复 / 缺失 / 时序非法 → 直接 FAIL（无 silent drop）。
 * - Tool / Boundary / Final 独立报告（不聚合掩盖缺样本）。
 *
 * 分段：
 * A. addToolOutput → continuation request arrival：Client dispatch（React commit + SDK auto-continue + transport）
 * B. request arrival → first SSE write：local mock gap（≈0 网络；真实 Provider 这里是 Server+Provider TTFT）
 * C. first SSE → target DOM mutation：UI 处理（throttle + render + commit）
 * D. DOM mutation → next paint（每 marker 至多一次 rAF）
 * E. first SSE → visible paint（= C + D）
 *
 * 验收（Target vs CI Gate 分离）：
 * - 产品观测目标（报告值，不作硬断言）：A median ≤ 50ms、p95 ≤ 100ms
 * - CI regression gate：以 cleaned baseline（本文件连续 3 次运行）为准，见文件底部。
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

function sse(lines: string[]): string {
  return lines.map((l) => `data: ${l}`).join("\n\n") + "\n\n";
}

type Stage = "tool" | "boundary" | "final";

interface RequestRec {
  turnIndex: number;
  decision: Stage;
  arrivalTs: number;
  firstWriteTs: number;
}

interface MarkerRecord {
  turnIndex: number;
  requestStage: Stage;
  mutationAt: number;
  paintAt: number;
}

function startToolLoopServer(toolCount: number, gapMs: number) {
  const requests: RequestRec[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // ---- deterministic turnIndex：从当前 User prompt「检查任务 N」解析（非 lastUserIdx surrogate）----
      let turnIndex = -1;
      let outputCount = 0;
      let boundaryEmitted = false;
      try {
        const parsed = JSON.parse(body || "{}") as {
          messages?: {
            role: string;
            content?: string;
            parts?: { type: string; state?: string; toolName?: string; text?: string }[];
          }[];
        };
        const messages = parsed.messages ?? [];
        let lastUserIdx = -1;
        for (let i = 0; i < messages.length; i++) {
          if (messages[i].role === "user") lastUserIdx = i;
        }
        const lastUser = lastUserIdx >= 0 ? messages[lastUserIdx] : undefined;
        const promptText =
          lastUser?.content ??
          (lastUser?.parts ?? []).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join("");
        const m = /检查任务 (\d+)/.exec(promptText ?? "");
        turnIndex = m ? parseInt(m[1], 10) : -1;
        const currentParts = messages.slice(lastUserIdx + 1).flatMap((mm) => mm.parts ?? []);
        outputCount = currentParts.filter(
          (p) => p.type.startsWith("tool-") && p.state === "output-available" && !p.toolName?.startsWith("begin_")
        ).length;
        boundaryEmitted = currentParts.some((p) => p.type === "tool-begin_final_answer" && p.state === "output-available");
      } catch {
        /* 忽略 */
      }
      if (turnIndex < 0) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "no turnIndex" }));
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "access-control-allow-origin": "*",
      });
      const rec: RequestRec = { turnIndex, decision: "tool", arrivalTs: Date.now(), firstWriteTs: 0 };
      requests.push(rec);
      const send = (stages: { delay?: number; events: string[] }[], decision: Stage) => {
        rec.decision = decision;
        void (async () => {
          for (const st of stages) {
            if (st.delay) await new Promise((r) => setTimeout(r, st.delay));
            if (st.events.length > 0) {
              if (rec.firstWriteTs === 0) rec.firstWriteTs = Date.now();
              res.write(sse(st.events));
            }
          }
          res.end();
        })();
      };
      // 阶段 1：business tool 链（唯一 marker：CAL_TOOL_{turnIndex}）
      if (outputCount < toolCount) {
        const idx = outputCount + 1;
        send(
          [
            {
              delay: gapMs,
              events: [
                JSON.stringify({ type: "start", messageId: `cal-${turnIndex}` }),
                JSON.stringify({ type: "start-step" }),
                JSON.stringify({ type: "text-start", id: `ct${turnIndex}_${idx}` }),
                JSON.stringify({ type: "text-delta", id: `ct${turnIndex}_${idx}`, delta: `CAL_TOOL_${turnIndex}` }),
                JSON.stringify({ type: "text-end", id: `ct${turnIndex}_${idx}` }),
              ],
            },
            {
              delay: 0,
              events: [
                JSON.stringify({ type: "tool-input-start", toolCallId: `call_cal_${turnIndex}_${idx}`, toolName: "search_assignments" }),
                JSON.stringify({ type: "tool-input-delta", toolCallId: `call_cal_${turnIndex}_${idx}`, inputTextDelta: '{"scope":"today"}' }),
                JSON.stringify({ type: "tool-input-available", toolCallId: `call_cal_${turnIndex}_${idx}`, toolName: "search_assignments", input: { scope: "today" } }),
                JSON.stringify({ type: "finish-step" }),
                JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
              ],
            },
          ],
          "tool"
        );
        return;
      }
      // 阶段 2：boundary 单独一回合（finish tool-calls → client emit → SDK 自动续跑）
      if (!boundaryEmitted) {
        send(
          [
            {
              delay: gapMs,
              events: [
                JSON.stringify({ type: "start", messageId: `cal-${turnIndex}` }),
                JSON.stringify({ type: "start-step" }),
                JSON.stringify({ type: "tool-input-start", toolCallId: `call_cal_${turnIndex}_b`, toolName: "begin_final_answer" }),
                JSON.stringify({ type: "tool-input-delta", toolCallId: `call_cal_${turnIndex}_b`, inputTextDelta: "{}" }),
                JSON.stringify({ type: "tool-input-available", toolCallId: `call_cal_${turnIndex}_b`, toolName: "begin_final_answer", input: {} }),
                JSON.stringify({ type: "finish-step" }),
                JSON.stringify({ type: "finish", finishReason: "tool-calls" }),
              ],
            },
          ],
          "boundary"
        );
        return;
      }
      // 阶段 3：final answer（唯一 marker：CAL_FINAL_{turnIndex}）
      send(
        [
          {
            delay: gapMs,
            events: [
              JSON.stringify({ type: "start", messageId: `cal-${turnIndex}` }),
              JSON.stringify({ type: "start-step" }),
              JSON.stringify({ type: "text-start", id: `cal-f-${turnIndex}` }),
              JSON.stringify({ type: "text-delta", id: `cal-f-${turnIndex}`, delta: `CAL_FINAL_${turnIndex}` }),
              JSON.stringify({ type: "text-end", id: `cal-f-${turnIndex}` }),
              JSON.stringify({ type: "finish-step" }),
              JSON.stringify({ type: "finish", finishReason: "stop" }),
            ],
          },
        ],
        "final"
      );
    });
  });
  return new Promise<{ url: string; requests: RequestRec[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/sse`,
        requests,
        close: async () => {
          server.closeAllConnections();
          await new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return -1;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const LOOP = 25;
const STAGES: Stage[] = ["tool", "boundary", "final"];

test("PERF Continuation: 25 次 local Tool loop 定标（turn/stage 精确配对；无永久 polling）", async ({ page }) => {
  const sse = await startToolLoopServer(1, 25);
  await page.route("**/api/ai/chat", (route) => route.continue({ url: sse.url }));
  await page.addInitScript(({ settings, key, turnCount }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
    const w = window as unknown as Record<string, unknown>;
    w.__kiroTurnPerf = [];
    const expectedTurns = Array.from({ length: turnCount }, (_, i) => ({
      turnIndex: i,
      messageId: `cal-${i}`,
      toolMarker: `CAL_TOOL_${i}`,
      finalMarker: `CAL_FINAL_${i}`,
      toolSeen: false,
      boundarySeen: false,
      finalSeen: false,
    }));
    const perf = {
      expectedTurns,
      markers: [] as MarkerRecord[],
      longTasks: { count: 0, maxMs: 0 },
    };
    w.__kiroCalPerf = perf;

    const record = (msgEl: Element, stage: Stage, exp: (typeof expectedTurns)[number]) => {
      const turnIndex = exp.turnIndex;
      const idx = perf.markers.length;
      perf.markers.push({ turnIndex, requestStage: stage, mutationAt: performance.now(), paintAt: 0 });
      // 每个 marker 至多一次 rAF（marker 真实观察到才注册）
      requestAnimationFrame(() => {
        const m = perf.markers[idx];
        if (m && m.paintAt === 0) m.paintAt = performance.now();
      });
    };

    const pendingByMessageId = new Map<string, (typeof expectedTurns)[number]>();
    for (const t of expectedTurns) pendingByMessageId.set(t.messageId, t);

    // 只检查「发生变化的那个 Assistant message」的局部状态（不重读历史消息）
    const checkMessage = (msgEl: Element) => {
      const id = msgEl.getAttribute("data-message-id");
      if (!id) return;
      const exp = pendingByMessageId.get(id);
      if (!exp) return; // 历史 / 非预期消息
      const text = msgEl.textContent ?? "";
      if (!exp.toolSeen && text.includes(exp.toolMarker)) {
        exp.toolSeen = true;
        record(msgEl, "tool", exp);
      }
      if (!exp.finalSeen && text.includes(exp.finalMarker)) {
        exp.finalSeen = true;
        record(msgEl, "final", exp);
      }
      if (!exp.boundarySeen) {
        const header = msgEl.querySelector('[data-testid="kiro-worklog"] [role="status"]');
        if (header?.textContent?.includes("正在整理回答")) {
          exp.boundarySeen = true;
          record(msgEl, "boundary", exp);
        }
      }
      if (exp.toolSeen && exp.boundarySeen && exp.finalSeen) pendingByMessageId.delete(id);
    };

    const toElement = (n: Node): Element | null =>
      n instanceof Element ? n : n.parentElement instanceof Element ? n.parentElement : null;

    const attachMain = () => {
      const convRoot = document.querySelector('[data-testid="kiro-conversation"]');
      if (!convRoot) return false;
      const obs = new MutationObserver((records) => {
        for (const rec of records) {
          // 新增节点：新 assistant message 挂载
          for (let i = 0; i < rec.addedNodes.length; i++) {
            const node = rec.addedNodes[i];
            const el = node instanceof Element ? node : null;
            if (!el) continue;
            const direct = el.hasAttribute("data-message-id") ? el : el.querySelector?.('[data-message-id]');
            if (direct instanceof Element) checkMessage(direct);
          }
          // 局部变化：从 mutation target 向上找所属 message
          const targetEl = toElement(rec.target);
          const msgEl = targetEl?.closest?.("[data-message-id]");
          if (msgEl instanceof Element) checkMessage(msgEl);
        }
      });
      obs.observe(convRoot, { subtree: true, childList: true, characterData: true });
      // longtask（仅计数 + 最大 duration；不支持则跳过）
      let longObs: PerformanceObserver | null = null;
      try {
        longObs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            perf.longTasks.count += 1;
            perf.longTasks.maxMs = Math.max(perf.longTasks.maxMs, entry.duration);
          }
        });
        longObs.observe({ entryTypes: ["longtask"] });
      } catch {
        longObs = null;
      }
      w.__kiroCalPerfDisconnect = () => {
        obs.disconnect();
        longObs?.disconnect();
      };
      return true;
    };

    // 先等 conversation root 出现（只监听 childList；找到后即断开，绝不常驻 document 扫描）
    if (!attachMain()) {
      const waitObs = new MutationObserver(() => {
        if (attachMain()) waitObs.disconnect();
      });
      waitObs.observe(document.documentElement ?? document, { childList: true, subtree: true });
    }
  }, { settings: AI_SETTINGS, key: "sk-test-key", turnCount: LOOP });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-composer")).toBeVisible({ timeout: 15000 });
  const composer = page.getByTestId("kiro-composer");
  for (let i = 0; i < LOOP; i++) {
    await composer.getByLabel("Ask Kiro").fill(`检查任务 ${i}`);
    try {
      await expect(composer.getByLabel("发送")).toBeEnabled({ timeout: 30000 });
    } catch (e) {
      const dump = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="kiro-composer"]');
        const btns = el ? Array.from(el.querySelectorAll("button")).map((b) => `${b.getAttribute("aria-label")}${b.hasAttribute("disabled") ? "!" : ""}`) : [];
        const w = window as unknown as { __kiroTurnPerf?: { name: string; at: number; key?: string }[] };
        return { btns, lastPerf: (w.__kiroTurnPerf ?? []).map((x) => `${x.name}:${x.key ?? ""}`).slice(-8) };
      });
      console.log(`[CAL][STUCK] i=${i} ${JSON.stringify(dump)} reqs=${sse.requests.length}`);
      throw e;
    }
    await composer.getByLabel("发送").click();
    await expect(page.getByTestId("kiro-message").last()).toContainText(`CAL_FINAL_${i}`, { timeout: 30000 });
  }
  // 等待全部 marker 记录完成（mutation → record 是微任务；避免与收集 evaluate 竞态）
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __kiroCalPerf?: { markers: unknown[] } }).__kiroCalPerf?.markers.length ?? 0), {
      timeout: 15000,
    })
    .toBe(LOOP * STAGES.length);
  // 等待 pending paint rAF 自然执行一次（§十三：允许自然执行，不 cancel）
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
  // 收集（全部 disconnect，含 longtask observer）
  const offset = await page.evaluate(() => Date.now() - performance.now());
  const data = await page.evaluate(() => {
    const w = window as unknown as {
      __kiroTurnPerf?: { name: string; at: number; key?: string }[];
      __kiroCalPerf?: { markers: MarkerRecord[]; longTasks: { count: number; maxMs: number } };
    };
    (w as { __kiroCalPerfDisconnect?: () => void }).__kiroCalPerfDisconnect?.();
    return {
      addToolOutputs: (w.__kiroTurnPerf ?? []).filter((e) => e.name === "addToolOutput").map((e) => ({ at: e.at, key: e.key ?? "" })),
      markers: w.__kiroCalPerf?.markers ?? [],
      longTasks: w.__kiroCalPerf?.longTasks ?? { count: 0, maxMs: 0 },
    };
  });

  // ================= correctness（先于性能 assertion） =================
  // request 按 `${turnIndex}:${stage}` 建 Map（重复 key → FAIL）
  const requestByKey = new Map<string, RequestRec>();
  for (const r of sse.requests) {
    const key = `${r.turnIndex}:${r.decision}`;
    if (requestByKey.has(key)) throw new Error(`[CAL] duplicate request key ${key}`);
    requestByKey.set(key, r);
  }
  const markerByKey = new Map<string, MarkerRecord>();
  for (const m of data.markers) {
    const key = `${m.turnIndex}:${m.requestStage}`;
    if (markerByKey.has(key)) throw new Error(`[CAL] duplicate marker key ${key}`);
    markerByKey.set(key, m);
  }
  // 完整性：每 turn × 每 stage 必须 request 与 marker 双双存在（无缺失、无多余）
  const missing: string[] = [];
  for (let i = 0; i < LOOP; i++) {
    for (const stage of STAGES) {
      const key = `${i}:${stage}`;
      const req = requestByKey.get(key);
      const marker = markerByKey.get(key);
      if (!req) missing.push(`${key} request`);
      if (!marker) missing.push(`${key} marker`);
    }
  }
  if (missing.length > 0) {
    // 调试日志：只输出 turnIndex/stage/messageId/request?/node?/header?（不 dump 正文）
    const probe = await page.evaluate((missingKeys) => {
      const out: Record<string, unknown> = {};
      for (const key of missingKeys) {
        const [ti, stage] = key.split(":");
        const el = document.querySelector(`[data-message-id="cal-${ti}"]`);
        const header = el?.querySelector('[data-testid="kiro-worklog"] [role="status"]');
        out[key] = {
          nodeExists: !!el,
          headerLabel: header?.textContent ?? null,
          hasTool: el?.textContent?.includes(`CAL_TOOL_${ti}`) ?? false,
          hasFinal: el?.textContent?.includes(`CAL_FINAL_${ti}`) ?? false,
        };
      }
      return out;
    }, missing);
    console.log(`[CAL][MISSING] ${JSON.stringify(probe)}`);
    throw new Error(`[CAL] missing pairs: ${missing.join(",")}`);
  }
  // 严格计数：25 / 25 / 25（显式 expected count）
  for (const stage of STAGES) {
    expect(Array.from(requestByKey.values()).filter((r) => r.decision === stage).length).toBe(LOOP);
    expect(Array.from(markerByKey.values()).filter((m) => m.requestStage === stage).length).toBe(LOOP);
  }
  // pair chronology validity：firstWriteTs <= mutationAt+offset <= paintAt+offset（非法 → FAIL，不静默丢弃）
  let validPairs = 0;
  const markerEntries = Array.from(markerByKey.entries());
  for (const entry of markerEntries) {
    const key = entry[0];
    const marker = entry[1];
    const req = requestByKey.get(key);
    if (!req) throw new Error(`[CAL] marker without request ${key}`);
    const mutationAbs = marker.mutationAt + offset;
    const paintAbs = marker.paintAt + offset;
    if (!(req.firstWriteTs <= mutationAbs && mutationAbs <= paintAbs)) {
      throw new Error(
        `[CAL] chronology violation ${key}: firstWrite=${req.firstWriteTs} mutation=${mutationAbs} paint=${paintAbs}`
      );
    }
    validPairs += 1;
  }
  console.log(`[CAL][CORRECT] expected=25/25/25 markers=25/25/25 validPairs=${validPairs}/${LOOP * STAGES.length}`);

  // ================= per-stage metrics =================
  // A：addToolOutput → continuation request arrival（toolCallId key → turnIndex:stage）
  const addToolAt = new Map<string, number>();
  for (const e of data.addToolOutputs) {
    const m = /call_cal_(\d+)_(1|b)/.exec(e.key);
    if (!m) continue;
    const stage: Stage = m[2] === "b" ? "boundary" : "tool";
    addToolAt.set(`${parseInt(m[1], 10)}:${stage}`, e.at);
  }
  const clientDispatch: number[] = [];
  const clientDispatchByStage: Record<Stage, number[]> = { tool: [], boundary: [], final: [] };
  const addToolEntries = Array.from(addToolAt.entries());
  for (const entry of addToolEntries) {
    const key = entry[0];
    const at = entry[1];
    const [ti, stage] = key.split(":") as [string, Stage];
    const nextStage: Stage = stage === "tool" ? "boundary" : "final";
    const next = requestByKey.get(`${ti}:${nextStage}`);
    if (next) {
      const delta = next.arrivalTs - (at + offset);
      if (delta >= 0) {
        clientDispatch.push(delta);
        clientDispatchByStage[stage].push(delta);
      }
    }
  }

  const summarize = (name: string, arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const out = {
      samples: sorted.length,
      medianMs: Math.round(percentile(sorted, 0.5) * 10) / 10,
      p95Ms: Math.round(percentile(sorted, 0.95) * 10) / 10,
      maxMs: sorted.length ? Math.round(sorted[sorted.length - 1] * 10) / 10 : null,
    };
    console.log(`[PERF][CAL] ${name} ` + JSON.stringify(out));
    return out;
  };
  const metricSets: Record<Stage, { B: number[]; C: number[]; D: number[]; E: number[] }> = {
    tool: { B: [], C: [], D: [], E: [] },
    boundary: { B: [], C: [], D: [], E: [] },
    final: { B: [], C: [], D: [], E: [] },
  };
  const markerEntries2 = Array.from(markerByKey.entries());
  for (const entry of markerEntries2) {
    const key = entry[0];
    const marker = entry[1];
    const req = requestByKey.get(key)!;
    const [ti, stage] = key.split(":") as [string, Stage];
    void ti;
    const mutationAbs = marker.mutationAt + offset;
    const paintAbs = marker.paintAt + offset;
    metricSets[stage].B.push(req.firstWriteTs - req.arrivalTs);
    metricSets[stage].C.push(mutationAbs - req.firstWriteTs);
    metricSets[stage].D.push(marker.paintAt - marker.mutationAt);
    metricSets[stage].E.push(paintAbs - req.firstWriteTs);
  }
  await sse.close();

  console.log(`[PERF][CAL][client-dispatch] addToolOutput→continuationRequest (tool)`);
  const cA = summarize("A.addToolOutput→continuationRequest(tool)", clientDispatchByStage.tool);
  console.log(`[PERF][CAL][client-dispatch] addToolOutput→continuationRequest (boundary)`);
  const cAB = summarize("A.addToolOutput→continuationRequest(boundary)", clientDispatchByStage.boundary);
  console.log(`[PERF][CAL][client-dispatch] addToolOutput→continuationRequest (all)`);
  const cATotal = summarize("A.addToolOutput→continuationRequest(all)", clientDispatch);
  const stageReports: Record<Stage, { B: ReturnType<typeof summarize>; C: ReturnType<typeof summarize>; D: ReturnType<typeof summarize>; E: ReturnType<typeof summarize> }> = {
    tool: { B: summarize("B.request→SSE(tool)", metricSets.tool.B), C: summarize("C.SSE→mutation(tool)", metricSets.tool.C), D: summarize("D.mutation→paint(tool)", metricSets.tool.D), E: summarize("E.SSE→paint(tool)", metricSets.tool.E) },
    boundary: { B: summarize("B.request→SSE(boundary)", metricSets.boundary.B), C: summarize("C.SSE→mutation(boundary)", metricSets.boundary.C), D: summarize("D.mutation→paint(boundary)", metricSets.boundary.D), E: summarize("E.SSE→paint(boundary)", metricSets.boundary.E) },
    final: { B: summarize("B.request→SSE(final)", metricSets.final.B), C: summarize("C.SSE→mutation(final)", metricSets.final.C), D: summarize("D.mutation→paint(final)", metricSets.final.D), E: summarize("E.SSE→paint(final)", metricSets.final.E) },
  };
  console.log(`[PERF][CAL] longTasks count=${data.longTasks.count} maxMs=${Math.round(data.longTasks.maxMs * 10) / 10}`);

  // ================= CI regression gate（以 cleaned baseline 为准） =================
  // 完整性 gate 永远先行
  expect(validPairs).toBe(LOOP * STAGES.length);
  expect(cA.samples).toBe(LOOP);
  expect(cAB.samples).toBe(LOOP);
  // Client dispatch：median < 60ms、p95 < 150ms（产品目标 ≤50ms / ≤100ms；
  // cleaned 实测 median 16~54ms、p95 24~118ms，偶发被 runtime GC/长任务顶到 ~120ms）
  expect(cA.medianMs).toBeLessThan(60);
  expect(cA.p95Ms).toBeLessThan(150);
  expect(cAB.p95Ms).toBeLessThan(150);
  // Tool / Boundary / Final：
  // - SSE→mutation p95 < 150ms（实测 median 30~54ms、p95 41~122ms；React commit + 24ms throttle）
  // - mutation→paint p95 < 250ms（实测 median 16~29ms；p95 会被 runtime long task 顺延 rAF 到 ~200ms）
  // - SSE→paint p95 < 300ms（极宽防炸护栏；实测 median 35~87ms 为常态，极端 GC/长任务偶发到 ~300ms）
  for (const stage of STAGES) {
    const rep = stageReports[stage];
    expect(rep.C.samples).toBe(LOOP);
    expect(rep.D.samples).toBe(LOOP);
    expect(rep.E.samples).toBe(LOOP);
    expect(rep.C.p95Ms).toBeLessThan(150);
    expect(rep.D.p95Ms).toBeLessThan(250);
    expect(rep.E.p95Ms).toBeLessThan(300);
  }
});
