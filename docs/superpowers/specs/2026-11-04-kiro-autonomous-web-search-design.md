# Kiro 自主联网搜索 — 设计（2026-11-04）

> 状态：已按本设计实现（V1，含 keyless 正文读取）。  
> 基线：`master` @ `3b6baac1`  
> 目标：让 Kiro 在桌面版默认配置下，能够自主判断并完成联网搜索，不要求用户先配置搜索 Key。

---

## 1. 结论先行

**核心能力已经存在，缺的不是“工具”，而是“默认可用的搜索通道 + 可用性真值”。**

现状：

- `web_search` / `read_web_source` 已经是 server-side Tool，接入 `streamText` 多步循环；
- 默认 `webSearchEnabled = true`，Prompt 也已写明“需要最新信息时优先搜索”；
- 但默认 `webSearchCredentialMode = "server"`，而桌面版打包后没有 `TAVILY_API_KEY`；
- 结果是：**Kiro 会拿到 `web_search` 工具，但第一次调用就返回 `WEB_SEARCH_KEY_REQUIRED`**；
- Settings 里“ClassFlow 提供”与真实能力不一致，用户只能切到 BYOK 并每次会话重新输入 Tavily Key。

因此本设计不重写 Agent，而是补三层：

1. **零配置搜索通道**：Tavily Key 存在时用 Tavily；不存在时自动走官方 keyless 搜索服务（Exa / Parallel hosted MCP），无需账号和 Key。
2. **可用性真值**：请求开始时解析本轮搜索能力；不可用时不暴露工具，并向模型注入明确的 capability 段，禁止“假装搜过”。
3. **自主搜索策略**：Prompt 明确“默认可用、时效问题先搜、中文结果不佳时用英文关键词再搜一次、限流如实说明”，并配合缓存/降级避免免费额度被一次对话打空。

实现范围：**V1 同时包含搜索通道、可用性、UI/测试，以及 `read_web_source` 的 keyless 正文兜底**（Native Reader 失败后走 Exa/Parallel fetch）。这样“自主搜索 → 读取证据 → 引用”在无 Key 环境下闭环。

---

## 2. 现状审计

### 2.1 已经生效的部分

| 层 | 位置 | 现状 |
|---|---|---|
| 请求体 | `hooks/useKiroChat.ts` | Send 时冻结 `webSearchConfig`（enabled / credentialMode / BYOK key）；Turn 内不被 UI 修改影响 |
| 服务端校验 | `lib/ai/server.ts` | `webSearchConfig` 白名单归一；未知字段丢弃；Key 不落日志 |
| 工具组装 | `lib/ai/web/tool.ts` | `assembleKiroToolsForRequest` 在 enabled 时注入 `web_search` + `read_web_source` |
| 搜索执行 | `lib/ai/web/tool.ts` | 每 Turn ≤3 次；分配 `web-N`；重复 query / 跨搜索 URL 去重；domain diversity；失败也计 attempt |
| 证据读取 | `lib/ai/web/evidenceRuntime.ts` | Native Reader 优先；失败后 Tavily Extract fallback；Turn ≤2 次；证据字符预算 |
| 引信 | `lib/ai/citations/*`、`components/kiro/*` | `[[source:web-N]]` 渲染、来源面板、历史恢复、PDF 页码 |
| Prompt | `lib/ai/prompts/kiroSystemPrompt.ts` | 已有完整 Kiro Search 策略：时效、官方来源、exactMatch、Search/Read 分工、引用规则 |
| 测试 | `tests/kiroWebSearch.test.ts` 等 | 98 个相关用例通过（本次审计已实跑） |

### 2.2 关键缺口

#### G1（P0）默认凭据不可用

`resolveWebSearchCredential({ mode: "server" })` 只读 `KIRO_TAVILY_API_KEY` / `TAVILY_API_KEY`。桌面版打包后没有注入这两个环境变量，也没有通过 SecretVault 提供搜索 Key 的路径。结果是：

- 默认设置下 `web_search` 必然失败；
- Settings 的“ClassFlow 提供”实际不成立；
- 用户必须切到 BYOK，而 BYOK Key 只存在 `sessionStorage`，重启应用后再次失效。

#### G2（P0）工具暴露与真实可用性脱节

`assembleKiroToolsForRequest` 只看 `webSearchEnabled`，不看凭据能否解析。凭据缺失时仍把 `web_search` 交给模型，模型会消耗一步、拿到错误，再向用户解释“搜索失败”。这不是自主，而是可预期的失败。

#### G3（P1）Provider 单点

`getKiroWebSearchProvider("tavily")` 是唯一实现。Tavily 超时 / 429 / 网络失败时没有同层降级；桌面端也没有“无 Key 时的第二通道”。

#### G4（P1）自主搜索缺少运行时真值

Prompt 说“web_search 可用时”，但 System Context 没有明确告诉模型“本轮到底可不可用、是基础搜索还是增强搜索”。模型只能从 tools 列表推断；一旦工具存在但执行必失败，推断就是错的。

#### G5（P2）中文 / 英文检索策略缺失

中文 query 在英文索引上可能返回弱结果。现有 Prompt 只说“换一个更简洁的 query”，没有明确“中文结果不佳时用英文关键词重试一次”的稳定策略。

#### G6（P2）免费额度没有缓存/冷却

一旦引入 keyless 通道，3 次/Turn 的额度会很快打满共享免费额度。需要进程内短 TTL 缓存 + provider 冷却，避免重复 query 和 429 风暴。

---

## 3. 设计目标与非目标

### 目标

1. 全新安装、默认设置、无任何搜索 Key 时，Kiro 能完成一次真实联网搜索并给出 `[[source:web-N]]` 引用。
2. 有 `TAVILY_API_KEY` 或 BYOK Tavily Key 时，行为、结果质量、额度语义保持现有 Tavily 路径不变。
3. 搜索不可用时，模型不会调用工具、不会编造来源；UI 给出可行动的说明。
4. 免费通道有确定性上限：每 Turn ≤3 次、进程内缓存、provider 429 冷却、失败安全错误码。
5. 不把任何搜索 Key、provider 原始响应、用户对话内容写入日志或 Store。

### 非目标

- 不重写 `web_search` / `read_web_source` 的 citation、trust boundary、Turn 状态机。
- 不新增“搜索开关”或改变默认 `webSearchEnabled=true`。
- 不引入浏览器自动化 / 网页抓取登录态。
- 不在 V1 支持 Exa / Parallel 的 BYOK Key 设置（Tavily BYOK 仍是唯一用户 Key 入口）。
- BYOK Tavily Key 只通过 SecretVault 持久化；Renderer 不读取明文，Store 只保存 `credentialRef`。
- remote-channel（QQ / 邮件）允许 `web_search` / `read_web_source`，但额度收紧为 1 次搜索 / 1 次读取；写工具仍拒绝。
- 不保证免费通道 SLA；它是“默认可用的基础搜索”，增强稳定性仍靠用户 Tavily Key 或未来服务端通道。

---

## 4. 核心设计

### 4.1 能力分层

```text
Kiro Chat Turn
  │
  ├─ resolveKiroWebSearchAccess(webSearchConfig)
  │     ├─ keyed   : Tavily (server env key 或 BYOK key)
  │     ├─ keyless : Exa / Parallel hosted MCP（CJK 顺序见 4.3）
  │     └─ unavailable : BYOK 未填 Key
  │
  ├─ assembleKiroToolsForRequest(access)
  │     ├─ available   → client tools + web_search + read_web_source
  │     └─ unavailable → 仅 client tools（不暴露 web_search）
  │
  ├─ buildKiroWebSearchCapabilitySection(access)
  │     └─ 注入 System Prompt：可用 / 基础 / 增强 / 不可用
  │
  └─ web_search.execute
        ├─ keyed   → Tavily Search
        └─ keyless → cache → (CJK ? Parallel : Exa) → 另一个 → safe error
```

### 4.2 凭据与访问模式

用户可见模式保持两个，避免新增设置项：

| `webSearchCredentialMode` | 解析顺序 | 缺失时 |
|---|---|---|
| `server`（默认，UI 改名“自动”） | `KIRO_TAVILY_API_KEY` → `TAVILY_API_KEY` → **keyless** | 永远可用（keyless） |
| `byok` | 用户 Tavily Key | `WEB_SEARCH_KEY_REQUIRED`，**绝不**回落到 server key 或 keyless |

关键规则：

- **BYOK 失败绝不静默 fallback**。用户选择“自己的 Key”就是明确要求使用自己的额度；缺 Key / 401 / 429 都返回安全错误，避免把查询发到另一个服务。
- `server` 模式没有 env Key 时，使用 keyless；这是“ClassFlow 提供”的新含义：不是承诺共享一个付费 Key，而是提供免 Key 的基础通道。
- `webSearchEnabled=false` 仍然完全关闭，不解析凭据、不暴露工具。

内部新增：

```ts
type KiroWebSearchAccess =
  | { ok: true; kind: "keyed"; apiKey: string; mode: "server" | "byok" }
  | { ok: true; kind: "keyless"; mode: "server" }
  | { ok: false; code: "WEB_SEARCH_KEY_REQUIRED"; message: string };
```

`resolveWebSearchCredential` 保留现有返回字段（`apiKey` / `mode`）以降低改动面，新增 `kind`：

- keyed：`{ ok:true, apiKey, mode, kind:"keyed" }`
- server 无 Key：`{ ok:true, apiKey:"", mode:"server", kind:"keyless" }`
- byok 无 Key：保持 `{ ok:false, code:"WEB_SEARCH_KEY_REQUIRED" }`

### 4.3 Keyless Provider 选择

**为什么是 Exa + Parallel，而不是抓 Bing/Google：**

- 两者都是官方 hosted MCP，明确允许无账号 / 无 Key 使用，免费额度面向个人 Agent / 探索场景；
- 返回结构化、LLM-ready 的结果，不需要解析搜索引擎 HTML；
- 不依赖非官方 SERP 接口，不存在 Bing/Google 抓取条款与反爬风险；
- 与 ClassFlow 的个人学习工具定位一致；商业分发前仍需复核各自条款。

**Provider 顺序：**

1. **Keyed Tavily**（如果存在 server/BYOK Key）——中文结果最好，用户已有额度。
2. **Keyless 通道**：
   - **CJK query**：Parallel 优先（中文官方站点覆盖较好）→ Exa；
   - **非 CJK query**：Exa 优先（英文/全球资料质量稳定，返回 title/url/published/highlights）→ Parallel。
3. 全部失败 → `WEB_SEARCH_RATE_LIMITED` / `WEB_SEARCH_TIMEOUT` / `WEB_SEARCH_FAILED` 安全错误。

并行/额度说明：Exa 的免费 keyless 额度实测更宽；Parallel 的匿名免费额度更容易触发限制（HTTP 200 + JSON-RPC `error`，不一定是 HTTP 429）。因此 CJK 优先 Parallel 只是“首次命中质量”策略，一旦 Parallel 进入冷却，后续自动走 Exa。

不把 Tavily keyless 放进 V1：实测其 daily keyless cap 很低，容易在正常使用中立即 429，反而制造噪音。Tavily 的价值在 keyed 额度。

**本地实测（2026-11-04，仅用于验证可行性，不作为 SLA）：**

| 通道 | 结果 |
|---|---|
| Exa `mcp.exa.ai/mcp` | 连续 3 次搜索 200；返回 title/url/published/highlights；中文主题用英文关键词可命中教育部官网 |
| Parallel `search.parallel.ai/mcp` | 连续 3 次搜索 200；第 4 次左右返回 HTTP 200 + JSON-RPC `error`（free-tier rate limit）；中文 query 可命中 chsi 官方报名页 |
| Tavily keyless | 首次搜索 200；随后很快返回 daily cap 429；不适合作为默认通道 |
| Tavily keyed | 现有路径不变；中文结果质量最好 |

因此默认 keyless 用 Exa，Parallel 作为第二通道；CJK query 可先试 Parallel 以提高中文命中，但 Parallel 冷却后必须自动回 Exa。

**语言策略：**

- 路由器不做自动翻译（避免引入额外模型调用）。
- Prompt 指导模型：中文 query 结果不相关时，用英文关键词再搜一次；例如“2026 考研报名时间” → “2026 China postgraduate entrance exam registration time official”。
- 这是“模型自主搜索”的一部分，不改变工具 schema。
- 路由器只做 CJK 检测（`/[\u3400-\u9FFF]/`）来决定 provider 顺序；不改变 query 文本。

### 4.4 Keyless 请求契约

两个 provider 都走统一的 MCP JSON-RPC helper：

```http
POST https://mcp.exa.ai/mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_search_exa","arguments":{...}}}
```

```http
POST https://search.parallel.ai/mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"web_search","arguments":{...}}}
```

共同约束：

- 固定 endpoint，**不接受模型或用户传入 URL**；SSRF 面不扩大。
- 外层仍是 `WEB_SEARCH_TIMEOUT_MS = 10s`；router 每次 provider attempt 用 **5s** 子预算，确保第一个超时后仍有一次 fallback 的机会。
- 256 KiB 响应上限，流式有界读取。
- 只发送 query / objective / filters；不发送对话、课程、任务、附件、API Key。
- Parallel 的 `session_id` 使用进程启动时生成的随机 UUID，仅用于其免费额度关联，不含用户身份。
- 不记录 query / 结果正文；debug 只允许 provider id / 状态码 / 耗时。
- 429 / 5xx / 403 不暴露 provider 原始 body。
- **HTTP 200 但 JSON-RPC `error` 也要处理**：Parallel 的免费额度限制实测返回 `{"error":{"code":-32000,"message":"You've hit the free-tier rate limit..."}}`；message 命中 `/rate limit|too many/i` 时映射为 `WEB_SEARCH_RATE_LIMITED` 并进入冷却。
- Exa keyless 在 IPv6/代理网络可能返回 403；router 将它视为“当前 provider 不可用”，直接 fallback 到 Parallel，不向模型暴露 403 细节。

**Exa 参数映射：**

| ClassFlow 参数 | Exa `web_search_exa` |
|---|---|
| `query` | `query` |
| `topic=news` / `timeRange` / 官方/排除域名 | 拼入 `objective`（自然语言约束） |
| 结果数 | `numResults = 8`（再经 ClassFlow 过滤到 6） |
| `exactMatch` | query 保留引号短语；objective 说明必须精确匹配 |

**Parallel 参数映射：**

| ClassFlow 参数 | Parallel `web_search` |
|---|---|
| `query` | `search_queries: [query]`；`includeDomains` 追加 `site:domain`（最多 5 个） |
| `topic=news` / `timeRange` / 官方/排除域名 | `objective` 自然语言约束 |
| `exactMatch` | `objective` 要求精确短语；query 不强制加引号（其 schema 不建议 quoted phrases） |
| 结果数 | provider 默认 10；ClassFlow 过滤到 6 |
| 会话关联 | `session_id`（随机 UUID） |

**结果归一化：**

- URL 只接受 http/https；
- 标题 trim，空标题回退 domain；
- 去掉简单的 HTML tag / 实体，snippet 折叠空白 + 900 字符截断；
- `publishedAt` 尽量归一为 `YYYY-MM-DD`；无法解析 → undefined，不猜；
- 复用现有 `canonicalWebSearchUrl` 去重与 `filterWebSearchResults` domain diversity；
- `sourceId` 仍由 `createKiroWebSearchTool` 分配，provider 永远返回 `sourceId: ""`。

### 4.5 缓存与冷却

新增进程内 `KiroWebSearchCache`（不持久化）：

- 只缓存 `sourceId: ""` 的 provider-neutral 结果，缓存命中后由 Tool 层重新分配 `web-N`；
- key：normalized query + topic + timeRange + include/excludeDomains + exactMatch；
- TTL：5 分钟；
- 上限：64 条；超过后按插入顺序淘汰；
- 只缓存成功且结果非空的归一化结果；错误不缓存；
- 同 key 的并发请求合并（single-flight），避免同一 Turn 并行重复搜索。

新增 `KiroWebSearchCooldown`：

- provider 429 / 5xx / 403 / timeout 后进入冷却；
- 优先使用响应 `Retry-After`，否则 60s；上限 10 分钟；
- 路由器跳过冷却中的 provider；
- 全部冷却 → 返回最后一个安全错误；
- 测试可注入 clock / reset。

### 4.6 可用性真值与 Prompt

新增 `lib/ai/web/capability.ts`：

```ts
export function buildKiroWebSearchCapabilitySection(access: KiroWebSearchAccess | null): string
```

四种输出：

- **关闭**（`webSearchEnabled=false`）：
  - “本轮联网搜索已关闭。不要调用 web_search，不要声称已搜索。”
- **基础搜索可用**（keyless）：
  - “本轮联网搜索可用：基础搜索（免 Key）。遇到新闻/政策/价格/版本/公告/招生等时效信息，先自主搜索，不要先问用户。中文结果不相关时可用英文关键词再搜一次。每轮最多 3 次；限流时如实说明。”
- **增强搜索可用**（keyed）：
  - “本轮联网搜索可用：增强搜索。按现有 Kiro Search 策略自主使用。”
- **不可用**（BYOK 缺 Key）：
  - “本轮联网搜索不可用（已选择自备 Key 但尚未配置）。不要调用 web_search，不要引用网页来源；如需最新信息，提示用户在设置中填写 Tavily Key。”

路由层：

```ts
const access = parsed.webSearchConfig?.enabled
  ? resolveKiroWebSearchAccess(parsed.webSearchConfig)
  : null;
```

- `assembleKiroToolsForRequest` 接收 `access`；`access.ok === false` 时不注入 `web_search` / `read_web_source`。
- `systemMessage` 在 `desktopRuntimeCapabilityContext` 附近追加 capability section。
- `textOnlyAnswer === true`（纯文本追答）时，**不要**注入“搜索可用”段；该轮零工具，capability 必须与 `textOnlySuffix` 一致。
- `web_search.execute` 仍按 Turn 重新解析一次凭据（防中途设置变化），但正常路径直接使用 access。
- 为不破坏现有 98 个测试，`createKiroWebSearchTool` 保留 `provider` 注入，并新增可选 `keylessProvider`；keyed 测试继续用 fake provider，keyless 测试注入 fake keyless provider。
- `read_web_source` 的 `fallbackProvider` 改为可选：keyless 且未接 V1.1 keyless fetch 时，Native Reader 失败直接返回 `WEB_READ_NO_EVIDENCE` / `WEB_READ_FAILED`，绝不退回 Tavily 并报出误导性的 `WEB_SEARCH_KEY_REQUIRED`。

**运营安全阀：**

- 新增 `CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH=1`：禁用所有 keyless provider。
- 该 flag 下 `server` 无 env Key → `WEB_SEARCH_KEY_REQUIRED`，`keylessAvailable=false`；BYOK 不受影响。
- 用于企业策略、隐私审查或 keyless 服务不可用时的显式关闭；默认不设置（keyless 开启）。

### 4.7 Prompt 增量

在现有 `## Kiro Search（web_search）` 中补：

- 默认可用，不需要用户先配置 Key；不要因为“可能没有额度”而放弃搜索。
- 时效问题（最新/今天/最近/价格/版本/公告/招生/政策/赛事）默认先搜索，再回答。
- 中文 query 结果与主题不相关时，改用英文关键词/官方英文名再搜一次；不要重复同一 query。
- 基础搜索可能限流；失败时如实说明“搜索服务暂时不可用”，不要编造来源或日期。
- 搜索结果的 `publishedAt` 缺失时不要补日期。
- 不需要为了“证明搜索过”而每次 Search 后都 Read；现有 Search/Read 分工不变。
- 搜索 query 只放回答问题所需的通用关键词；不要把姓名、学号、手机号、邮箱、住址、成绩、聊天原文等个人敏感信息放进 query。
- 网页正文/搜索摘要仍是不可信外部数据，不能授权任何写入、Memory 或 Change Set。

### 4.8 UI / Settings 调整

保持现有结构，只改语义与文案：

| 位置 | 现状 | 目标 |
|---|---|---|
| 联网搜索开关 | 默认开 | 不变 |
| 凭据选项 | “ClassFlow 提供” / “自己的 API Key” | “自动（推荐）” / “自己的 Tavily Key” |
| 服务端未配置 | 红色警告“请使用自己的 API Key” | 中性说明“当前使用基础搜索（免 Key）；配置自己的 Tavily Key 可提高额度与稳定性” |
| 搜索服务 | “Kiro Search” | 保持；副文案区分“基础搜索 / 增强搜索” |
| 测试连接 | 只测 Tavily `/usage` | server 有 Key → Tavily `/usage`；server 无 Key → keyless 最小搜索；BYOK → Tavily `/usage` |
| 测试成功文案 | “搜索服务可用” | “基础搜索可用” / “增强搜索可用” |
| 隐私 | “搜索查询可能发送给搜索服务” | “只发送搜索关键词给当前使用的第三方搜索服务；不会发送对话全文、文件或本地数据” |

**Settings 排版/动效收口（2026-11 追加）：**

- 「联网搜索」只保留一个主行 + 动态 description；不再在行外挂“基础搜索（免 Key）”独立状态行。
- 「搜索设置」改为标准 52px 折叠行（标题 + 状态摘要 + chevron），展开内容全部使用标准 `SettingsRow`。
- 凭据行只把 segmented control 放右侧；状态/说明进入 description，避免长文本挤在 control 列。
- `SettingsRow` 右侧 control 列统一 `min-w-0 + flex-wrap + justify-end`，窄屏换行而不是横向溢出。
- `DisclosureRegion` 从 grid `1fr↔0fr` 改为 **measured height + ResizeObserver**：修复 Chromium 在 auto-height/overflow 宿主内 grid 过渡卡在起始值导致的硬切，并支持展开期间动态文案高度变化。
- 「高级设置」按钮与搜索设置行统一 52px 行高/divider；回答偏好说明移到左侧 description。

`/api/ai/web-search/status` 扩展为：

```json
{ "ok": true, "serverConfigured": false, "keylessAvailable": true }
```

不返回 provider 名称、Key、额度、usage。UI 用 `keylessAvailable` 决定是否显示“基础搜索”说明。

`/api/ai/web-search/test`：

- `mode=server` + env Key → Tavily `/usage`（不消耗搜索额度）；
- `mode=server` 无 env Key → Exa 最小搜索（`numResults:1`），失败则 Parallel；这会消耗 1 次 keyless 请求，按钮在测试中保持禁用；
- `mode=byok` + Key → Tavily `/usage`；
- `mode=byok` 无 Key → `WEB_SEARCH_KEY_REQUIRED`；
- 返回 `{ ok:true, mode:"basic"|"enhanced" }`（产品级，不含 vendor）。

### 4.9 已实现 / 不在本期的部分

已在 V1 实现：

- `web_search` keyless（Exa / Parallel 路由）。
- `read_web_source` keyless 正文兜底：Native Reader 失败后，用 Exa `web_fetch_exa` / Parallel `web_fetch` 读取，仍不产生不可信页码（HTML/普通网页只给 `[[source:web-N]]`）。
- capability 真值、缓存、single-flight、429 冷却、Settings/Status/Test 真值。
- 运营安全阀 `CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH`。
- **BYOK Tavily Key SecretVault 持久化**：`SecretProvider = "tavily"`；Renderer 只保存 `credentialRef`（localStorage 仅 ref），Chat/Test 路由在主进程 resolve 明文；旧 sessionStorage Key 自动迁移。
- **remote-channel 联网搜索**：`invocationFilter` 允许 `web_search` / `read_web_source`；每轮收紧为 1 次搜索 / 1 次读取；写工具仍拒绝。
- **首次实际联网搜索一次性隐私提示**：Conversation Surface 在首个 `tool-web_search` part 后显示，点击「知道了」持久化；可关闭搜索。

仍不在本期：

- Exa / Parallel BYOK Key 设置：用于提高免费额度。
- Tavily keyless 作为最后兜底。
- OpenCode Go hosted web search：官方文档显示 OpenCode/Go 用户可使用 hosted search，但它是 Console/Agent 侧能力，未确认可作为外部应用独立 API 使用；不作为 V1 依赖，待有稳定公开接口再评估。

---

## 5. 文件级改动清单（V1）

### 新增

| 文件 | 职责 |
|---|---|
| `lib/ai/web/keyless/mcp.ts` | 固定 endpoint 的 JSON-RPC 调用、SSE/JSON 解析、单次 attempt 5s timeout、256KiB 上限、JSON-RPC error 归一 |
| `lib/ai/web/keyless/exa.ts` | `web_search_exa` 请求/解析/归一化；`checkCredential` 最小搜索 |
| `lib/ai/web/keyless/parallel.ts` | `web_search` 请求/解析/归一化；`session_id`；`site:` 映射 |
| `lib/ai/web/keyless/router.ts` | CJK 顺序（Parallel 优先，否则 Exa 优先）、降级、缓存、single-flight、冷却、时间/域名后过滤 |
| `lib/ai/web/capability.ts` | access 解析 + capability Prompt section |
| `tests/kiroWebSearchKeyless.test.ts` | MCP 请求/解析/错误/上限 |
| `tests/kiroWebSearchRouter.test.ts` | 降级、缓存、冷却、BYOK 不 fallback |
| `tests/kiroWebSearchCapability.test.ts` | 工具暴露、Prompt 真值、设置语义 |

### 修改

| 文件 | 改动 |
|---|---|
| `lib/ai/web/types.ts` | `KiroWebSearchProviderId` 扩展；新增 `KiroWebSearchAccess`；新增 keyless 常量 |
| `lib/ai/web/credentials.ts` | `server` 无 Key → keyless access；`byok` 缺 Key 保持失败；读取 `CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH` |
| `lib/ai/web/tool.ts` | 使用 access；不可用不暴露工具；`web_search` 走 router；新增可选 `keylessProvider` 保持测试注入；保留 Turn 状态机 |
| `lib/ai/web/provider.ts` | 注册 keyless providers / router（供 test 与 tool 使用） |
| `app/api/ai/chat/route.ts` | 请求开始解析 access；注入 capability section（`textOnlyAnswer` 除外）；传 access 给 assemble |
| `app/api/ai/web-search/status/route.ts` | 返回 `serverConfigured` + `keylessAvailable` |
| `app/api/ai/web-search/test/route.ts` | server 无 Key 时测试 keyless；BYOK 缺 Key 保持失败 |
| `components/settings/KiroAISettings.tsx` | 文案/状态/测试结果 |
| `lib/settingsRegistry.ts` | 搜索关键词与描述更新 |
| `store/useKiroPreferencesStore.ts` | 默认值不变；仅在需要时调整 normalizer 注释 |
| `lib/ai/prompts/kiroSystemPrompt.ts` | 自主搜索 / 英文重试 / 限流说明 |
| `README.md` / `.env.example` | 基础搜索免 Key；Tavily Key 可选 |
| `tests/kiroWebSearch.test.ts` | 更新 server 无 Key 的旧断言；新增 keyless 路径断言 |

---

## 6. 测试计划

### 6.1 单元测试（默认 CI，无网络）

**凭据/可用性**

1. server + env key → keyed Tavily。
2. server 无 env key → keyless，`ok:true`。
3. byok + key → keyed Tavily。
4. byok 无 key → `WEB_SEARCH_KEY_REQUIRED`，不调用任何 provider。
5. byok 401/429 → 不 fallback keyless。
6. `webSearchEnabled=false` → 不解析、不暴露工具。

**Exa/Parallel adapter**

7. 请求体是 JSON-RPC `tools/call`，endpoint 固定，Accept 正确。
8. Exa `web_search_exa` 参数：query / objective / numResults=8。
9. Parallel `web_search` 参数：objective / search_queries / session_id；includeDomains → `site:`。
10. SSE `data:` 与直接 JSON 两种响应都能解析。
11. Exa 文本块 → title/url/publishedAt/snippet；非法 URL skip；最多 8 条。
12. Parallel `structuredContent` 与 JSON text 两种结果都能解析。
13. 429 → `WEB_SEARCH_RATE_LIMITED`；keyed Tavily 401/403 → `WEB_SEARCH_AUTH_FAILED`；keyless 403 → 当前 provider 不可用并 fallback，最终失败才 `WEB_SEARCH_FAILED`；timeout → `WEB_SEARCH_TIMEOUT`。
14. 响应超过 256KiB → 安全失败；原始 body 不进入错误 message。
15. 不返回 provider 的 request id / raw response / query 日志。
16. HTTP 200 + JSON-RPC `error`（rate limit）→ `WEB_SEARCH_RATE_LIMITED`，并触发冷却。
17. 单次 attempt 5s timeout：第一个 provider 超时后仍有时间 fallback；外层 10s 总 timeout 不被突破。

**Router / 缓存 / 冷却**

18. 非 CJK query：Exa 成功 → 不调用 Parallel。
19. CJK query：Parallel 优先；Parallel 失败/冷却 → Exa。
20. Exa 429 → Parallel 成功；结果使用 Parallel。
21. Exa + Parallel 都 429 → `WEB_SEARCH_RATE_LIMITED`。
22. 相同 query 5 分钟内命中缓存 → 不重复请求。
23. 并发相同 query → single-flight，只发一次。
24. 429 后冷却期内跳过该 provider；过期后恢复。
25. 缓存命中仍重新分配 `web-N`（sourceId 由 Tool 层分配）。
26. `timeRange` 后过滤：超出窗口的结果被丢弃；无日期结果保留；`includeDomains` / `excludeDomains` 后过滤正确。

**Tool / Prompt / 路由**

27. server 无 Key → `assembleKiroToolsForRequest` 仍包含 `web_search`。
28. byok 无 Key → 不包含 `web_search` / `read_web_source`。
29. capability section：基础/增强/关闭/不可用四种文案；不包含 Key / provider 原始信息。
30. `textOnlyAnswer=true` → 不注入“搜索可用”段，保持零工具。
31. `CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH=1` → server 无 Key 时 `WEB_SEARCH_KEY_REQUIRED`，`keylessAvailable=false`。
32. `web_search.execute` 在 keyless 下分配连续 `web-N`。
33. Turn ≤3 次、重复 query、跨搜索 URL 去重等现有行为不变。
34. `read_web_source` 仍只信任当前 Turn 真实 Search 结果。
35. keyless 时 Native Reader 失败 → auto evidence provider（Exa/Parallel fetch）兜底；不再出现误导性 `WEB_SEARCH_KEY_REQUIRED`；不产生页码。
36. 状态路由返回 `serverConfigured` + `keylessAvailable`，不泄漏 Key。
37. 测试路由 server 无 Key 时走 keyless，返回 `mode:"basic"`；BYOK 缺 Key 仍失败。

**Settings**

38. server 无 Key 不再显示红色“未配置”警告。
39. 凭据选项显示“自动（推荐）”/“自己的 Tavily Key”。
40. 测试成功文案区分“基础搜索可用”/“增强搜索可用”。
41. 隐私文案说明第三方搜索服务。
42. 现有 preference modified/reset 行为不变。

### 6.2 集成 / 真实网络（gated）

新增 `tests/kiroWebSearchLive.test.ts`，仅当 `KIRO_WEB_SEARCH_LIVE=1` 时运行：

- 无 `TAVILY_API_KEY` 环境下，直接调用 keyless router 搜索“latest AI news”，断言至少 1 条 http/https 结果；
- 断言结果不含 `sourceId` 之外的 provider 原始字段；
- 不断言具体标题/域名，避免网络波动导致 flaky。

新增 Agent live smoke（可选，需要模型 Key）：

- 空 Key 环境，输入“今天有什么 AI 新闻？”，断言出现 `tool-web_search` 且最终回答含 `[[source:web-N]]`；
- 失败时打印 bounded 诊断，不打印 query/结果正文。

### 6.3 回归

- `node node_modules/vitest/vitest.mjs run tests/kiroWebSearch.test.ts tests/kiroWebEvidence.test.ts tests/kiroWebEvidenceRuntime.test.ts tests/kiroWebPresentation.test.ts`
- 受影响 Settings 测试：`tests/kiroAISettingsTransport.test.ts`、`tests/kiroPreferencesModifiedReset.test.tsx`、`tests/e2e/settings-v4.1.spec.ts`
- `npm run typecheck`
- `npm run build`
- `npm run security:secrets`

---

## 7. 验收标准

1. 全新安装 + 默认设置 + 无任何搜索 Key，Kiro 问“今天有什么 AI 新闻”会真实调用 `web_search`，返回来源并渲染引用。
2. 搜索关闭时，模型不调用工具，不声称搜索过。
3. BYOK 未填 Key 时，不暴露工具；Final Answer 明确提示配置 Key，不编造来源。
4. 有 `TAVILY_API_KEY` 时，请求仍走 Tavily，body/headers 与现有测试一致。
5. 429 / timeout / 5xx 时，模型只看到安全错误码，不看到 provider 原始 body。
6. 同一 query 在 5 分钟内重复出现时不重复请求 provider；并发相同 query 只发一次。
7. Settings 不再出现“服务端未配置，请使用自己的 Key”这种与默认能力矛盾的红色警告。
8. `CLASSFLOW_DISABLE_KEYLESS_WEB_SEARCH=1` 时，server 无 Key 会明确回到 `WEB_SEARCH_KEY_REQUIRED`，且 Settings 显示需要配置 Key。
9. remote-channel（QQ / 邮件）可以使用 `web_search` / `read_web_source`，但每轮最多 1 次搜索 / 1 次读取；写工具仍被拒绝。
10. localStorage / Zustand 只出现 `credentialRef`，不出现 Tavily 明文 Key；SecretVault 密文之外无 secret。

---

## 8. 风险与开放决策

### 风险

1. **免费额度与 SLA**：Exa/Parallel keyless 是免费个人额度，不适合高并发或商业 SLA。设计上用缓存、冷却、每 Turn 3 次和 Tavily BYOK 升级路径兜底。
2. **第三方隐私**：查询会发送给 Exa / Parallel（或已配置的 Tavily）。必须在 Settings 与 README 明确说明；不发送对话/文件/本地数据。中国大陆网络环境下，向境外搜索服务发送 query 的合规披露需要产品/法务确认；搜索开关本身是用户可关闭的 opt-out。
3. **共享出口 IP**：校园网/NAT 下多个用户共享出口 IP，免费额度可能更快触发；缓存/冷却/Parallel 备份与 Tavily BYOK 是缓解手段。
4. **Exa IPv4 要求**：官方文档说明 keyless 需要直连 IPv4；IPv6/代理网络可能 403。Parallel 作为第二通道；两者都失败时返回安全错误。
5. **Provider 契约变化**：hosted MCP 的 tool schema 可能变化；适配器必须 fail safe，不把原始错误暴露给模型。
6. **免费通道被滥用**：每 Turn 3 次 + 缓存 + 冷却；没有跨用户共享池，因为每个桌面客户端独立请求。
7. **条款复核**：Exa/Parallel 免费额度面向个人/探索；若 ClassFlow 商业分发，需要重新评估或改为服务端 keyed 通道。

### 决策记录

1. **Exa + Parallel 作为默认 keyless 通道**：已确认并实现。
2. **`server` UI 改成“自动（推荐）”**：已实现。
3. **V1 包含 `read_web_source` keyless 正文兜底**：已实现。
4. **BYOK Tavily Key 迁入 SecretVault**：已实现（renderer 只持 ref，明文只进 Main）。
5. **首次联网搜索隐私提示**：已实现（首个真实 `tool-web_search` 后一次性提示，dismiss 持久化）。
6. **remote-channel 联网搜索**：已实现，额度收紧为 1 次搜索 / 1 次读取；写工具仍拒绝。

---

## 9. 实施顺序（获批后）

1. **RED**：新增 access / adapter / router / capability 测试，先跑失败。
2. Keyless MCP helper + Exa adapter + Parallel adapter。
3. Router：缓存、single-flight、冷却、降级。
4. 接入 `resolveWebSearchAccess` / `assembleKiroToolsForRequest` / `web_search.execute`。
5. 路由 capability section + Prompt 增量。
6. Status/Test/Settings 文案与状态。
7. 更新旧测试断言；补 live gated 测试。
8. `typecheck` + 受影响 vitest + `build` + `security:secrets`。
9. 更新 README / `.env.example`；提交并推送 `master`。

---

## 10. 参考

- 现有实现：`lib/ai/web/tool.ts`、`lib/ai/web/credentials.ts`、`lib/ai/web/tavily.ts`、`lib/ai/web/evidenceRuntime.ts`
- 现有 Prompt：`lib/ai/prompts/kiroSystemPrompt.ts`（`## Kiro Search`）
- 现有测试：`tests/kiroWebSearch.test.ts`、`tests/kiroWebEvidence.test.ts`、`tests/kiroWebPresentation.test.ts`
- Exa MCP：`https://mcp.exa.ai/mcp`（keyless search/fetch，官方文档）
- Parallel Search MCP：`https://search.parallel.ai/mcp`（keyless search/fetch，官方文档）
- Tavily keyless：`X-Tavily-Access-Mode: keyless`（官方文档；V1 不作为默认，因 daily cap 很低）
