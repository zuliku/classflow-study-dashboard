# Kiro Computer Agent V1 Part 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Kiro's independent Computer Runtime foundation, workspace/grant control plane, permission policy, model reasoning controls, and productized Composer/Settings controls without yet exposing filesystem/document mutation tools to the model.

**Architecture:** Keep the existing Kiro Harness and add a separate `lib/ai/computer/*` trust domain. Computer access is workspace-first and adapter-driven; sandbox boundaries and permission decisions stay separate. Reasoning is model-capability-driven and frozen per turn, while live Computer grants/rules remain runtime state. Part 1 creates the safe shell and control plane that Part 2 will use for real file/document tools.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand 4.5, AI SDK 7 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`), IndexedDB / File System Access API, Vitest, Playwright, existing ClassFlow UI primitives.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-13-kiro-computer-agent-v1-design.md`.
- Architecture = Approach B: independent Computer Runtime integrated into existing Kiro Harness.
- Sandbox is a technical boundary; Permission is a policy decision. Permission must never enlarge sandbox roots.
- Model-facing resources use logical `workspaceId + rootId + relative path`, never raw native paths/handles.
- Chromium real-folder support uses File System Access API only after explicit user gesture; unsupported environments use Kiro Sandbox backed by IndexedDB.
- Usable Web V1 Agent Modes: `plan`, `guided`, `workspace-auto`; no usable `full-access` mode.
- Do not expose shell, PowerShell, command execution, delete-file/delete-directory, app launch, MCP, or arbitrary network capability.
- Reasoning and response preference are distinct. Reasoning controls model inference when supported; response preference remains final-answer presentation depth.
- Reasoning support is capability-driven. Do not infer support from model name/vendor/transport. If support cannot be verified against the current installed provider integration, the model remains `default` only.
- Preserve current DeepSeek official compatibility behavior that forces thinking disabled while tool calling is used; do not present adjustable reasoning for that path unless current code-level support is deliberately changed and verified.
- No raw `FileSystemDirectoryHandle`, absolute native path, permission token, or file bytes in chat history or model request body.
- No new dependencies in Part 1.
- `hooks/useKiroChat.ts` remains orchestration/router code; Computer execution/policy logic belongs under `lib/ai/computer`.
- Computer mode enhances the existing `KiroComposer`; do not create a second chat product.
- Composer direction: borrow the supplied Codex reference's information hierarchy—workspace/context quiet at the top, clean prompt area, execution controls grouped near send—without copying branding or adding fake branch semantics.
- Test policy: targeted Vitest + `npm run typecheck` + one focused Playwright file at most. Do not run full Vitest, full Playwright, or build by default.

---

## Exact File Map

### Create
- `lib/ai/computer/types.ts`
- `lib/ai/computer/errors.ts`
- `lib/ai/computer/capabilities.ts`
- `lib/ai/computer/policy.ts`
- `lib/ai/computer/prepare.ts`
- `lib/ai/computer/workspace/resolver.ts`
- `lib/ai/computer/workspace/grants.ts`
- `lib/ai/computer/adapters/types.ts`
- `lib/ai/computer/adapters/browser.ts`
- `lib/ai/computer/adapters/sandbox.ts`
- `lib/ai/reasoning/types.ts`
- `lib/ai/reasoning/providerOptions.ts`
- `store/useKiroComputerStore.ts`
- `components/settings/KiroAgentSettings.tsx`
- `components/kiro/computer/KiroWorkspacePicker.tsx`
- `components/kiro/computer/KiroAgentModeMenu.tsx`
- `components/kiro/computer/KiroReasoningMenu.tsx`
- `tests/unit/kiro-computer-policy.test.ts`
- `tests/unit/kiro-computer-store.test.ts`
- `tests/unit/kiro-reasoning.test.ts`
- `tests/e2e/kiro-computer-controls.spec.ts`

### Modify
- `lib/ai/providers/types.ts`
- `lib/ai/providers/capabilities.ts`
- `lib/ai/providers/registry.ts`
- `lib/ai/providers/openCodeGo.ts`
- `lib/ai/providers/deepSeek.ts`
- `store/useAISettingsStore.ts`
- `types/index.ts`
- `components/settings/KiroAISettings.tsx`
- `components/settings/SettingsNav.tsx`
- `components/settings/SettingsView.tsx`
- `lib/settingsRegistry.ts`
- `components/kiro/KiroComposer.tsx`
- `components/kiro/KiroChatSurface.tsx`
- `hooks/useKiroChat.ts`
- `lib/ai/contextBudget/types.ts`
- `lib/ai/tools/index.ts`
- `app/api/ai/chat/route.ts`

---

## Task 1 — Computer Runtime Types, Modes, Policy, and Logical Path Boundary

**Files:**
- Create: `lib/ai/computer/types.ts`
- Create: `lib/ai/computer/errors.ts`
- Create: `lib/ai/computer/capabilities.ts`
- Create: `lib/ai/computer/policy.ts`
- Create: `lib/ai/computer/prepare.ts`
- Create: `lib/ai/computer/workspace/resolver.ts`
- Test: `tests/unit/kiro-computer-policy.test.ts`

**Core interfaces:**

```ts
export type KiroAgentMode = "plan" | "guided" | "workspace-auto";
export type ComputerPermissionEffect = "allow" | "ask" | "deny";

export type ComputerCapability =
  | "workspace.list"
  | "fs.list"
  | "fs.search"
  | "fs.read"
  | "fs.create"
  | "fs.modify"
  | "fs.move"
  | "fs.delete"
  | "document.create"
  | "document.modify"
  | "app.open"
  | "app.reveal"
  | "shell.execute"
  | "network.access";

export interface ComputerPermissionRule {
  id: string;
  effect: ComputerPermissionEffect;
  capability: ComputerCapability;
  workspaceId?: string;
  rootId?: string;
  resourcePattern?: string;
  scope: "persistent" | "session";
}

export interface KiroWorkspaceRootMeta {
  id: string;
  label: string;
  access: "read-only" | "read-write";
  adapterRef: string;
}

export interface KiroWorkspaceMeta {
  id: string;
  name: string;
  roots: KiroWorkspaceRootMeta[];
  instructionsFile?: "KIRO.md";
  createdAt: string;
  updatedAt: string;
}

export interface LogicalComputerResource {
  workspaceId: string;
  rootId: string;
  path: string;
}
```

- [ ] **Write RED policy/path tests first.** Required cases:
  - Plan: read allow, create/modify deny.
  - Guided: read/create allow, modify/move ask, destructive/execute deny.
  - Workspace Auto: read/create/modify allow, move ask, destructive/execute deny.
  - read-only root hard-denies mutation regardless of mode.
  - explicit deny rule wins over allow mode default.
  - safe relative path normalizes separators and internal `.`/`..`.
  - `../secret`, leading `/`, drive path, UNC path, NUL/control chars, and Windows reserved device names are rejected.

Run only:

```bash
npx vitest run tests/unit/kiro-computer-policy.test.ts
```

Expected before implementation: FAIL.

- [ ] **Implement exact mode defaults** in `capabilities.ts`:

```ts
export const AGENT_MODE_DEFAULTS = {
  plan: {
    "workspace.list": "allow",
    "fs.list": "allow",
    "fs.search": "allow",
    "fs.read": "allow",
    "fs.create": "deny",
    "fs.modify": "deny",
    "fs.move": "deny",
    "fs.delete": "deny",
    "document.create": "deny",
    "document.modify": "deny",
    "app.open": "deny",
    "app.reveal": "deny",
    "shell.execute": "deny",
    "network.access": "deny",
  },
  guided: {
    "workspace.list": "allow",
    "fs.list": "allow",
    "fs.search": "allow",
    "fs.read": "allow",
    "fs.create": "allow",
    "fs.modify": "ask",
    "fs.move": "ask",
    "fs.delete": "deny",
    "document.create": "allow",
    "document.modify": "ask",
    "app.open": "deny",
    "app.reveal": "deny",
    "shell.execute": "deny",
    "network.access": "deny",
  },
  "workspace-auto": {
    "workspace.list": "allow",
    "fs.list": "allow",
    "fs.search": "allow",
    "fs.read": "allow",
    "fs.create": "allow",
    "fs.modify": "allow",
    "fs.move": "ask",
    "fs.delete": "deny",
    "document.create": "allow",
    "document.modify": "allow",
    "app.open": "deny",
    "app.reveal": "deny",
    "shell.execute": "deny",
    "network.access": "deny",
  },
} as const;
```

- [ ] **Implement policy precedence**:
  1. V1 hard deny (`fs.delete`, `app.open`, `app.reveal`, `shell.execute`, `network.access`);
  2. read-only root mutation deny;
  3. matching explicit deny;
  4. most-specific matching explicit allow/ask;
  5. mode default.

No glob dependency. Part 1 may support exact resource path and simple normalized `prefix/**` only.

- [ ] **Implement `normalizeRelativeComputerPath()`** with `/` normalization, traversal escape prevention, absolute/drive/UNC rejection, control-char rejection, and case-insensitive Windows reserved basename rejection (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`, including extensions).

- [ ] **Implement `prepareComputerTool()`** as preflight only:

```ts
export function prepareComputerTool(input: {
  mode: KiroAgentMode;
  rules: ComputerPermissionRule[];
  workspace: KiroWorkspaceMeta;
  capability: ComputerCapability;
  resource?: LogicalComputerResource;
}): ComputerPolicyDecision
```

It must not touch native handles or execute mutations.

- [ ] **Run GREEN:**

```bash
npx vitest run tests/unit/kiro-computer-policy.test.ts
```

- [ ] **Commit:**

```bash
git add lib/ai/computer tests/unit/kiro-computer-policy.test.ts
git commit -m "feat(kiro): add computer policy foundation"
```

---

## Task 2 — Workspace Metadata Store and Native Grant Boundary

**Files:**
- Create: `store/useKiroComputerStore.ts`
- Create: `lib/ai/computer/adapters/types.ts`
- Create: `lib/ai/computer/adapters/browser.ts`
- Create: `lib/ai/computer/adapters/sandbox.ts`
- Create: `lib/ai/computer/workspace/grants.ts`
- Test: `tests/unit/kiro-computer-store.test.ts`

**State interface:**

```ts
export interface KiroComputerState {
  computerEnabled: boolean;
  activeWorkspaceId: string | null;
  agentMode: KiroAgentMode;
  workspaces: KiroWorkspaceMeta[];
  permissionRules: ComputerPermissionRule[];
  setComputerEnabled(enabled: boolean): void;
  setActiveWorkspaceId(id: string | null): void;
  setAgentMode(mode: KiroAgentMode): void;
  addWorkspace(workspace: KiroWorkspaceMeta): void;
  updateWorkspace(id: string, patch: Partial<Omit<KiroWorkspaceMeta, "id">>): void;
  removeWorkspace(id: string): void;
  upsertPermissionRule(rule: ComputerPermissionRule): void;
  removePermissionRule(id: string): void;
}
```

Persist under `classflow-kiro-computer-v1`. Persist logical metadata plus persistent rules only. Native directory handles and session rules must not enter localStorage.

- [ ] **RED tests:** defaults are disabled / guided / no active workspace; enabling does not invent a workspace; removing active workspace clears selection; changing mode does not change roots; persisted JSON contains no handle/native path; session rule is not persisted.

```bash
npx vitest run tests/unit/kiro-computer-store.test.ts
```

- [ ] **Implement adapter capability contract:**

```ts
export type ComputerAdapterKind = "browser" | "sandbox";

export interface ComputerAdapterCapabilities {
  kind: ComputerAdapterKind;
  nativeWorkspace: boolean;
  canRead: boolean;
  canWrite: boolean;
  canOpenNativeFile: boolean;
  canRevealNativeFile: boolean;
}
```

Do not add shell/process/network methods.

- [ ] **Implement explicit-user-gesture Browser grant helper:**

```ts
export async function chooseBrowserWorkspaceDirectory(): Promise<{
  adapterRef: string;
  label: string;
} | null>
```

Only this explicit UI helper may call `window.showDirectoryPicker()`. It saves the returned handle in a dedicated IndexedDB grant store keyed by opaque `adapterRef`. User cancellation returns `null`.

Also implement:

```ts
export async function queryBrowserGrant(
  adapterRef: string
): Promise<"granted" | "prompt" | "denied" | "missing">
```

Use narrow local File System Access interfaces if DOM typings are incomplete; do not spread `any` across the runtime.

- [ ] **Implement Sandbox adapter identity/fallback namespace.** Part 1 needs capability/status plus a stable IndexedDB namespace only; Part 2 will add actual file records.

- [ ] **Run:**

```bash
npx vitest run tests/unit/kiro-computer-store.test.ts
npm run typecheck
```

- [ ] **Commit:**

```bash
git add store/useKiroComputerStore.ts lib/ai/computer/adapters lib/ai/computer/workspace/grants.ts tests/unit/kiro-computer-store.test.ts
git commit -m "feat(kiro): add computer workspace grants"
```

---

## Task 3 — Capability-Driven Reasoning Effort

**Files:**
- Create: `lib/ai/reasoning/types.ts`
- Create: `lib/ai/reasoning/providerOptions.ts`
- Modify: `lib/ai/providers/types.ts`
- Modify: `lib/ai/providers/capabilities.ts`
- Modify: `lib/ai/providers/registry.ts`
- Modify: `lib/ai/providers/openCodeGo.ts`
- Modify: `lib/ai/providers/deepSeek.ts`
- Modify: `store/useAISettingsStore.ts`
- Modify: `app/api/ai/chat/route.ts`
- Test: `tests/unit/kiro-reasoning.test.ts`

**Interfaces:**

```ts
export type KiroReasoningEffort = "default" | "low" | "medium" | "high";

export interface ReasoningCapability {
  adjustable: boolean;
  supportedEfforts: KiroReasoningEffort[];
  mechanism: "effort" | "anthropic-effort" | "thinking-budget" | "fixed";
}
```

Add optional `reasoning?: ReasoningCapability` to `AIModelDefinition.capabilities`. Add explicit Custom-provider declaration `reasoningEffort?: boolean` to `AICustomConfig`. Add persisted `reasoningEffort` to `AISettings`, default `"default"`, plus `setReasoningEffort` to `useAISettingsStore`.

- [ ] **Inspect installed SDK/provider types before mapping:**

```bash
grep -R "reasoningEffort\|effort.*low\|thinking.*budget" \
  node_modules/@ai-sdk/openai-compatible \
  node_modules/@ai-sdk/anthropic \
  node_modules/ai -n | head -100
```

Use the installed types as source of truth. Do not install packages and do not invent provider option keys.

- [ ] **RED tests** must prove:
  - missing reasoning capability = `default` only;
  - unsupported requested effort normalizes to `default` or a typed unsupported result with identical UI/server semantics;
  - `default` adds no provider override;
  - DeepSeek official remains fixed/default while its transform explicitly forces `thinking: { type: "disabled" }`;
  - Custom OpenAI becomes adjustable only when `custom.reasoningEffort === true`.

```bash
npx vitest run tests/unit/kiro-reasoning.test.ts
```

- [ ] **Declare built-in model support conservatively.** Do not mark every OpenAI-compatible or Anthropic-transport model adjustable. Only mark models whose current provider integration can be verified. If none can be proven, keep them fixed rather than show a fake control.

- [ ] **Implement server normalization:** client sends only `reasoningEffort`; server resolves model definition, normalizes against capability, builds verified provider options, and passes them to `streamText`. Client must never send raw `providerOptions`.

- [ ] **Preserve DeepSeek transform/schema compatibility logic.** Do not remove the existing tool-schema normalization or thinking-disable transform.

- [ ] **Run:**

```bash
npx vitest run tests/unit/kiro-reasoning.test.ts
npm run typecheck
```

- [ ] **Commit:**

```bash
git add lib/ai/reasoning lib/ai/providers store/useAISettingsStore.ts app/api/ai/chat tests/unit/kiro-reasoning.test.ts
git commit -m "feat(kiro): add reasoning effort controls"
```

---

## Task 4 — Turn Snapshot and Computer Tool-Domain Hook

**Files:**
- Modify: `hooks/useKiroChat.ts`
- Modify: `lib/ai/contextBudget/types.ts`
- Modify: `lib/ai/tools/index.ts`
- Modify: `app/api/ai/chat/route.ts`

**Snapshot:**

```ts
export interface KiroComputerTurnSnapshot {
  enabled: boolean;
  workspaceId: string | null;
  agentMode: KiroAgentMode;
  roots: Array<{
    id: string;
    label: string;
    access: "read-only" | "read-write";
  }>;
}
```

No `adapterRef`, native handle/path, permission rule, or permission token is serialized into this snapshot.

- [ ] At send boundary in `useKiroChat`, freeze current provider/model, reasoning effort, Computer enabled, active workspace logical metadata, and Agent Mode into the request used for that turn.
- [ ] Do not freeze grants/rules as authority. Live grant/rule changes must remain runtime state for future Computer tool calls.
- [ ] Validate Computer snapshot on server as context/tool-selection metadata only. Reject malformed IDs, absolute-looking values, and oversized root arrays.
- [ ] Refactor `lib/ai/tools/index.ts` just enough to support a future domain assembly function such as `getKiroToolsForRequest(...)`; **Part 1 must still return only existing Read/Write/Memory tools and must not expose Computer file tools.**
- [ ] Keep `useKiroChat.ts` free of Browser handle/File System Access execution code.

Run:

```bash
npm run typecheck
```

Commit:

```bash
git add hooks/useKiroChat.ts lib/ai/contextBudget/types.ts lib/ai/tools/index.ts app/api/ai/chat/route.ts
git commit -m "feat(kiro): snapshot computer agent turn controls"
```

---

## Task 5 — Settings IA: Reasoning + Separate Kiro Agent Section

**Files:**
- Create: `components/settings/KiroAgentSettings.tsx`
- Modify: `components/settings/KiroAISettings.tsx`
- Modify: `types/index.ts`
- Modify: `components/settings/SettingsNav.tsx`
- Modify: `components/settings/SettingsView.tsx`
- Modify: `lib/settingsRegistry.ts`

- [ ] Extend `SettingsSection` in `types/index.ts` with `"kiro-agent"`.
- [ ] Add nav item in `SettingsNav.tsx` immediately after `kiro`, label `Kiro Agent`, using a restrained computer/shield icon from existing lucide-react.
- [ ] Import/render `KiroAgentSettings` in `SettingsView.tsx` as a persistent section, consistent with all other settings sections.
- [ ] Add searchable registry rows in `lib/settingsRegistry.ts` for `ai-reasoning-effort`, `kiro-computer-enabled`, `kiro-agent-mode`, `kiro-agent-workspace`, and `kiro-agent-permissions`.

### KiroAISettings changes

- [ ] Add Reasoning row inside the existing `模型` group, not the `回答` group.
- [ ] If active model supports adjustable efforts, show `默认 / 低 / 中 / 高` filtered to its declared supportedEfforts.
- [ ] If active model is fixed, show neutral copy `当前模型不可调` rather than a fake enabled control.
- [ ] Keep `回答偏好` in the Answer group and retain wording that it affects final answer presentation, not reasoning/tools/safety.
- [ ] For Custom OpenAI advanced capabilities, add explicit checkbox `支持思考程度`; checking it only declares compatibility and still goes through server normalization.

### KiroAgentSettings required rows

```text
Computer Agent          ON/OFF
默认权限模式             计划 / 受控 / 工作区自动
当前 Workspace          name / 未配置
授权位置                 roots + 本地/Sandbox + read-only/read-write + grant status
添加位置                 explicit user-gesture button
活动与安全               V1 no shell/delete/full access
桌面能力                 Full Access / 终端 = 桌面版后续支持
```

- [ ] First enable with no workspace must route user to choose a real directory on supported Chromium or explicitly choose Kiro Sandbox. Cancelling the native picker keeps Computer disabled unless Sandbox is explicitly selected.
- [ ] Revoked/missing Browser grant shows `需要重新授权`; reauthorization is user-triggered and not background Agent behavior.

Run:

```bash
npm run typecheck
```

Commit:

```bash
git add components/settings types/index.ts lib/settingsRegistry.ts
git commit -m "feat(kiro): add agent and reasoning settings"
```

---

## Task 6 — Codex-Inspired Computer Composer Controls

**Files:**
- Create: `components/kiro/computer/KiroWorkspacePicker.tsx`
- Create: `components/kiro/computer/KiroAgentModeMenu.tsx`
- Create: `components/kiro/computer/KiroReasoningMenu.tsx`
- Modify: `components/kiro/KiroComposer.tsx`
- Modify: `components/kiro/KiroChatSurface.tsx`
- Test: `tests/e2e/kiro-computer-controls.spec.ts`

### Required layout

When Computer Agent ON:

```text
┌──────────────────────────────────────────────────────────┐
│ [论文研究]  [本地 / Sandbox]                             │
│                                                          │
│ Ask Kiro…                                                │
│                                                          │
│ +   @   Web   Computer ✓       [受控] [思考 中] [模型] ↑ │
└──────────────────────────────────────────────────────────┘
```

Do not add a Git branch chip; ClassFlow V1 has no branch semantic.

- [ ] Use existing shared Popover/Dropdown primitives for new workspace/mode/reasoning menus. Do not add new outside-click/Escape infrastructure.
- [ ] Add a low-noise Computer toggle next to existing context/web controls. OFF = neutral; ON = ClassFlow active treatment; disabled while `turnLocked`.
- [ ] Enabling with no valid workspace opens the controlled setup flow; do not set enabled true first and repair state later.
- [ ] When enabled, show a quiet workspace strip above prompt with active workspace name and `本地` / `Sandbox`; show grant warning if unavailable.
- [ ] Agent Mode menu visible only when Computer is ON. Exact user copy:

```text
计划       只读取和分析，不修改文件
受控       可创建；修改前询问
工作区自动 在授权 Workspace 内自动创建/修改；危险能力仍禁用
```

- [ ] Reasoning control uses the same `useAISettingsStore.reasoningEffort` as Settings. Show it only if the active model has more than one supported effort. Fixed models omit the Composer reasoning chip; Settings carries explanation.
- [ ] Desktop control order near send: `Agent Mode → Reasoning → Model → Send`. With Computer OFF: `Reasoning → Model → Send`.
- [ ] Sidecar/narrow layouts collapse labels without toolbar wrap/overlap. Keep model selector accessible.
- [ ] Preserve all current Composer behavior: attachments, drag/drop, paste, `@` context, Web Search, scanned-PDF/vision blocking, model unavailable state, submit/stop/loading, and turnLocked closing menus.

### Focused E2E

Create one test file only: `tests/e2e/kiro-computer-controls.spec.ts`.

Flow:
1. Open Kiro.
2. Verify Computer is initially OFF for clean test storage.
3. Use Kiro Sandbox setup path; do not rely on native directory picker in CI.
4. Verify Computer becomes ON and workspace strip says Sandbox.
5. Switch `受控 → 计划`; verify selected/pressed/menu state.
6. If fixture model is reasoning-adjustable, switch reasoning and verify; if fixture is fixed, verify Composer does not falsely show an adjustable reasoning chip.
7. Open Settings → Kiro Agent / Kiro & AI and verify the same Agent Mode / Reasoning stores are reflected.
8. Return to Kiro; verify state remains synchronized.
9. Do not test actual filesystem writes in Part 1.

Run only:

```bash
npx playwright test tests/e2e/kiro-computer-controls.spec.ts
```

Then:

```bash
npm run typecheck
```

Commit:

```bash
git add components/kiro tests/e2e/kiro-computer-controls.spec.ts
git commit -m "feat(kiro): add computer agent composer controls"
```

---

## Task 7 — Static Audit, Targeted Verification, STOP

- [ ] Audit leakage:

```bash
grep -R "showDirectoryPicker\|FileSystemDirectoryHandle\|adapterRef\|reasoningEffort\|computerEnabled\|workspace-auto" \
  hooks app lib store components -n
```

Confirm:
- `showDirectoryPicker` appears only in explicit workspace grant/setup code;
- directory handles do not enter `useAISettingsStore`, `useKiroComputerStore` persisted JSON, chat request types, or history serializers;
- client cannot submit arbitrary providerOptions;
- `useKiroChat.ts` contains no Computer filesystem execution;
- `KIRO_TOOLS` / request tool assembly exposes no Part 2 Computer file tools yet.

- [ ] Run only required unit tests together:

```bash
npx vitest run \
  tests/unit/kiro-computer-policy.test.ts \
  tests/unit/kiro-computer-store.test.ts \
  tests/unit/kiro-reasoning.test.ts
```

- [ ] Run only targeted E2E:

```bash
npx playwright test tests/e2e/kiro-computer-controls.spec.ts
```

If E2E cannot start because of infrastructure, report the exact blocker; do not substitute a full suite.

- [ ] Final typecheck:

```bash
npm run typecheck
```

- [ ] Build default = SKIP. Run `npm run build` only for a real Client/Server import boundary, Next route compile-only, or File System Access DOM typing/compile issue not resolved by typecheck.

### Part 1 Acceptance

All must hold:
- independent `lib/ai/computer` trust domain exists;
- Plan/Guided/Workspace Auto policy and hard-deny behavior exist;
- logical workspace metadata persists separately from native grants;
- supported Chromium has explicit user-gesture directory grant flow;
- unsupported browser has explicit Kiro Sandbox fallback;
- Reasoning Effort is distinct from response preference;
- unsupported/fixed models are not presented as adjustable;
- current DeepSeek forced-thinking-disabled compatibility remains intact;
- reasoning/model/mode/workspace are frozen at turn start;
- live grants/rules are not serialized as authority;
- Composer and Settings share the same Reasoning and Agent Mode stores;
- Kiro Agent is a separate Settings section from Kiro & AI;
- Computer Composer follows Codex-inspired hierarchy without copying branding or fake branch semantics;
- no Computer file mutation tools are model-facing yet;
- no shell/delete/app/MCP/full-access capability is exposed;
- existing attachment/context/Web Search/model/send behavior remains intact.

### Final Report

Report only:

```text
Kiro Computer Agent V1 — Part 1 Result

Commits:
- SHA + message

Runtime:
- Computer types/policy/preflight
- Workspace metadata/grants/adapters

Reasoning:
- capability model
- actually adjustable models/transports
- fixed/unsupported behavior

UI:
- Composer Computer mode
- Agent Mode
- Reasoning
- Workspace indicator
- Kiro Agent Settings

Turn integration:
- frozen snapshot fields
- live state intentionally excluded

Verification:
- targeted unit files
- targeted E2E
- typecheck
- build: PASS / skipped by policy

Deferred to Part 2:
- list/search/grep/read model-facing Computer tools
- create directory/text/document
- patch text
- Markdown/DOCX render/verify
- real mutation Action Cards
```

STOP. Do not begin Part 2.
