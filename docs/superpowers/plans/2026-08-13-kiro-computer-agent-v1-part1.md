# Kiro Computer Agent V1 Part 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Kiro's independent Computer Runtime foundation, workspace/grant model, permission policy, model reasoning controls, and productized Composer/Settings controls without yet exposing filesystem/document mutation tools to the model.

**Architecture:** Keep the existing Kiro Harness and add a separate `lib/ai/computer/*` trust domain. Computer access is workspace-first and adapter-driven; sandbox boundaries and permission decisions stay separate. Reasoning is model-capability-driven and frozen per turn, while live Computer grants/rules remain runtime state. Part 1 creates the safe shell and control plane that Part 2 will use for actual file/document tools.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand 4.5, AI SDK 7 (`ai`, `@ai-sdk/react`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`), IndexedDB / File System Access API, Vitest, Playwright, existing ClassFlow UI primitives.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-13-kiro-computer-agent-v1-design.md`.
- Architecture = Approach B: independent Computer Runtime integrated into existing Kiro Harness.
- Sandbox is a technical boundary; Permission is a policy decision. Permission must never enlarge sandbox roots.
- Model-facing Computer resources use logical `workspaceId + rootId + relative path`, never raw native paths/handles.
- Chromium real-folder support uses File System Access API only after explicit user gesture; unsupported environments use Kiro Sandbox backed by IndexedDB.
- V1 usable Agent Modes: `plan`, `guided`, `workspace-auto`; no usable Web `full-access` mode.
- V1 must not expose shell, PowerShell, command execution, delete-file/delete-directory, app launch, MCP, or arbitrary network capability.
- Reasoning and response preference are distinct. Reasoning controls model inference when supported; response preference remains output presentation depth.
- Reasoning support is capability-driven. Do not infer from model name/vendor. If a model/transport has no verified mechanism, it must resolve to `default` only.
- Current DeepSeek official compatibility transform forcibly disables thinking for tool-calling stability; Part 1 must not present unsupported adjustable reasoning for that transport unless code-level evidence changes.
- No raw `FileSystemDirectoryHandle`, absolute path, permission token, or file bytes in Kiro chat history or model request body.
- Do not add new dependencies in Part 1.
- Keep `useKiroChat.ts` as orchestration/router only; Computer execution/policy logic belongs under `lib/ai/computer`.
- Composer normal Kiro mode must remain usable; Computer mode enhances the same Composer rather than creating a separate chat product.
- Composer visual direction: borrow Codex-style information hierarchy (workspace/context top-left; agent/model/reasoning controls grouped low-noise near the send affordance) without copying branding or creating a separate design language.
- Test policy: prefer targeted Vitest + `npm run typecheck` + at most one targeted Composer/Settings Playwright file. Do not run full Vitest/Playwright/build by default.

---

## File Map

### Create
- `lib/ai/computer/types.ts` — shared Computer runtime/workspace/permission types.
- `lib/ai/computer/errors.ts` — Computer-domain error codes/helpers.
- `lib/ai/computer/capabilities.ts` — capability/risk constants and Agent Mode defaults.
- `lib/ai/computer/policy.ts` — deterministic permission evaluation.
- `lib/ai/computer/prepare.ts` — Part 1 preflight entry point; no file mutation execution yet.
- `lib/ai/computer/adapters/types.ts` — environment-independent adapter contract.
- `lib/ai/computer/adapters/browser.ts` — Browser File System Access grant helpers / adapter skeleton.
- `lib/ai/computer/adapters/sandbox.ts` — IndexedDB-backed sandbox adapter skeleton/state capability.
- `lib/ai/computer/workspace/types.ts` — workspace/root/grant metadata types if not kept in top-level types.
- `lib/ai/computer/workspace/grants.ts` — IndexedDB directory-handle grant persistence and permission querying.
- `lib/ai/computer/workspace/resolver.ts` — logical path validation and resource resolution boundary.
- `lib/ai/reasoning/types.ts` — reasoning effort/capability types.
- `lib/ai/reasoning/providerOptions.ts` — provider/transport-specific reasoning mapping.
- `store/useKiroComputerStore.ts` — persisted logical Computer UI/policy state, never native handles.
- `components/settings/KiroAgentSettings.tsx` — Computer Agent settings surface.
- `components/kiro/computer/KiroWorkspacePicker.tsx` — workspace/context selector surface.
- `components/kiro/computer/KiroAgentModeMenu.tsx` — Composer permission-mode control.
- `components/kiro/computer/KiroReasoningMenu.tsx` — Composer reasoning control.
- `tests/unit/kiro-computer-policy.test.ts` — policy/sandbox boundary tests.
- `tests/unit/kiro-reasoning.test.ts` — capability normalization/provider mapping tests.
- `tests/unit/kiro-computer-store.test.ts` — store defaults/mode/workspace behavior if existing store-test style supports it.

### Modify
- `lib/ai/providers/types.ts` — add reasoning capability metadata and custom capability declaration.
- `lib/ai/providers/capabilities.ts` — expose normalized reasoning capability.
- `lib/ai/providers/registry.ts` and provider model registries — explicitly declare verified reasoning support only.
- `store/useAISettingsStore.ts` — persist `reasoningEffort` and setter.
- `components/settings/KiroAISettings.tsx` — add Reasoning row in Model group; keep response preference separate.
- settings navigation/registry file(s) discovered by grep — surface `KiroAgentSettings` as a separate Kiro Agent section without bloating `KiroAISettings`.
- `components/kiro/KiroComposer.tsx` — Codex-inspired Computer mode hierarchy and controls.
- Composer parent (`KiroWorkspace.tsx` or actual current owner discovered by grep) — pass Computer/reasoning/workspace props/state.
- `hooks/useKiroChat.ts` — freeze reasoning/agent mode/workspace into turn request; no Computer execution logic in hook.
- `app/api/ai/chat/route.ts` — validate normalized reasoning/computer metadata and apply verified provider options; do not trust raw provider options from client.
- request/context types used by chat route — add minimal logical Computer snapshot.
- `lib/ai/tools/index.ts` or current server tool assembly — Part 1 only establishes Computer-domain registration gating hook; do not expose mutation tools yet.
- `lib/ai/contextBudget/types.ts` — include minimal turn snapshot metadata only if this is the canonical snapshot type.
- existing targeted Kiro/Settings E2E file, or create `tests/e2e/kiro-computer-controls.spec.ts` only if no focused existing file is suitable.

---

### Task 1: Define Computer Runtime Types, Modes, Policy, and Path Boundary

**Files:**
- Create: `lib/ai/computer/types.ts`
- Create: `lib/ai/computer/errors.ts`
- Create: `lib/ai/computer/capabilities.ts`
- Create: `lib/ai/computer/policy.ts`
- Create: `lib/ai/computer/prepare.ts`
- Create: `lib/ai/computer/workspace/resolver.ts`
- Test: `tests/unit/kiro-computer-policy.test.ts`

**Interfaces:**

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

export type ComputerRisk =
  | "read"
  | "create"
  | "modify"
  | "destructive"
  | "execute"
  | "external";

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

export interface ComputerPolicyContext {
  mode: KiroAgentMode;
  rules: ComputerPermissionRule[];
  workspace: KiroWorkspaceMeta;
  capability: ComputerCapability;
  rootId?: string;
  relativePath?: string;
}

export type ComputerPolicyDecision =
  | { effect: "allow"; source: string }
  | { effect: "ask"; source: string }
  | { effect: "deny"; source: string };
```

- [ ] **Step 1: Write policy tests before implementation**

Test exact behaviors:

```ts
import { describe, expect, it } from "vitest";
import { evaluateComputerPolicy } from "@/lib/ai/computer/policy";
import { normalizeRelativeComputerPath } from "@/lib/ai/computer/workspace/resolver";

const workspace = {
  id: "research",
  name: "论文研究",
  roots: [
    { id: "output", label: "输出", access: "read-write" as const, adapterRef: "grant-output" },
    { id: "raw", label: "原始数据", access: "read-only" as const, adapterRef: "grant-raw" },
  ],
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("computer policy", () => {
  it("plan allows reads and denies writes", () => {
    expect(evaluateComputerPolicy({ mode: "plan", rules: [], workspace, capability: "fs.read", rootId: "output" }).effect).toBe("allow");
    expect(evaluateComputerPolicy({ mode: "plan", rules: [], workspace, capability: "fs.create", rootId: "output" }).effect).toBe("deny");
  });

  it("guided allows create and asks modify", () => {
    expect(evaluateComputerPolicy({ mode: "guided", rules: [], workspace, capability: "fs.create", rootId: "output" }).effect).toBe("allow");
    expect(evaluateComputerPolicy({ mode: "guided", rules: [], workspace, capability: "fs.modify", rootId: "output" }).effect).toBe("ask");
  });

  it("workspace-auto still denies unsupported destructive/execute capabilities", () => {
    expect(evaluateComputerPolicy({ mode: "workspace-auto", rules: [], workspace, capability: "fs.delete", rootId: "output" }).effect).toBe("deny");
    expect(evaluateComputerPolicy({ mode: "workspace-auto", rules: [], workspace, capability: "shell.execute", rootId: "output" }).effect).toBe("deny");
  });

  it("read-only root hard-denies mutation even when mode would allow", () => {
    expect(evaluateComputerPolicy({ mode: "workspace-auto", rules: [], workspace, capability: "fs.modify", rootId: "raw" }).effect).toBe("deny");
  });

  it("explicit deny wins over an allow-mode default", () => {
    const rules = [{ id: "deny-output-modify", effect: "deny" as const, capability: "fs.modify" as const, workspaceId: "research", rootId: "output", scope: "persistent" as const }];
    expect(evaluateComputerPolicy({ mode: "workspace-auto", rules, workspace, capability: "fs.modify", rootId: "output" }).effect).toBe("deny");
  });
});

describe("computer paths", () => {
  it("normalizes safe relative paths", () => {
    expect(normalizeRelativeComputerPath("notes/../output/plan.md")).toBe("output/plan.md");
  });

  it.each(["../secret.txt", "/etc/passwd", "C:\\Users\\x", "\\\\server\\share", "CON.txt"])(
    "rejects path outside safe logical resource grammar: %s",
    (input) => expect(() => normalizeRelativeComputerPath(input)).toThrow()
  );
});
```

- [ ] **Step 2: Run only the policy test for RED**

```bash
npx vitest run tests/unit/kiro-computer-policy.test.ts
```

Expected: FAIL because Computer Runtime modules do not exist.

- [ ] **Step 3: Implement mode defaults and deterministic rule evaluation**

Mode defaults must be exactly:

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

Hard-deny precedence in Part 1:
1. unsupported V1 capabilities (`fs.delete`, `app.open`, `app.reveal`, `shell.execute`, `network.access`);
2. mutation against a read-only root;
3. matching explicit deny rule;
4. most-specific matching allow/ask rule;
5. mode default.

Do not implement a broad glob engine. `resourcePattern` may be persisted for future compatibility, but Part 1 policy matching may support only exact normalized path or an anchored `prefix/**` form if needed. Do not introduce a dependency.

- [ ] **Step 4: Implement logical-path normalization**

`normalizeRelativeComputerPath` must:
- convert `\\` to `/`;
- reject drive letters/UNC/leading `/`;
- process `.` and `..` without ever escaping root;
- reject empty final path where a file path is required;
- reject NUL/control characters;
- reject Windows reserved device basenames such as `CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9` case-insensitively even with extensions;
- return normalized `/` separators.

- [ ] **Step 5: Implement `prepareComputerTool` as Part 1 preflight only**

It receives logical operation metadata and returns allow/ask/deny; it must not touch browser handles or execute file writes yet.

```ts
export function prepareComputerTool(input: {
  mode: KiroAgentMode;
  rules: ComputerPermissionRule[];
  workspace: KiroWorkspaceMeta;
  capability: ComputerCapability;
  resource?: LogicalComputerResource;
}): ComputerPolicyDecision
```

- [ ] **Step 6: Run GREEN**

```bash
npx vitest run tests/unit/kiro-computer-policy.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit runtime policy foundation**

```bash
git add lib/ai/computer tests/unit/kiro-computer-policy.test.ts
git commit -m "feat(kiro): add computer policy foundation"
```

---

### Task 2: Add Workspace Metadata Store and Native Grant Persistence Boundary

**Files:**
- Create: `store/useKiroComputerStore.ts`
- Create: `lib/ai/computer/adapters/types.ts`
- Create: `lib/ai/computer/adapters/browser.ts`
- Create: `lib/ai/computer/adapters/sandbox.ts`
- Create: `lib/ai/computer/workspace/grants.ts`
- Test: `tests/unit/kiro-computer-store.test.ts`

**Interfaces:**

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

Persist store metadata to a dedicated key such as `classflow-kiro-computer-v1`. `partialize` must contain only logical metadata/rules/mode flags. It must not persist directory handles.

`lib/ai/computer/workspace/grants.ts` owns a separate IndexedDB database/store for native grants, keyed by opaque `adapterRef`.

- [ ] **Step 1: Write store tests**

Verify:
- default: disabled, mode `guided`, activeWorkspaceId `null`, empty workspaces/rules;
- enabling Computer does not invent a workspace;
- removing active workspace clears activeWorkspaceId;
- changing mode does not alter roots or rules;
- metadata serialization contains no `handle` property.

- [ ] **Step 2: RED run**

```bash
npx vitest run tests/unit/kiro-computer-store.test.ts
```

- [ ] **Step 3: Implement the Zustand store**

Keep session-only permission rules out of persisted state. Either maintain them in a separate in-memory field and exclude them from `partialize`, or persist only rules where `scope === "persistent"`.

- [ ] **Step 4: Define adapter boundary**

Part 1 adapter contract is capability/grant oriented and may include read/list method signatures for Part 2, but do not implement model-facing file tools yet.

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

`BrowserFileAdapter` may expose helper methods for resolving a granted directory handle but must require an existing user grant; it must never invoke `showDirectoryPicker()` from background Agent execution.

- [ ] **Step 5: Implement explicit-user-gesture grant creation**

Export a UI-triggered helper:

```ts
export async function chooseBrowserWorkspaceDirectory(): Promise<{
  adapterRef: string;
  label: string;
} | null>
```

Rules:
- call `window.showDirectoryPicker()` only inside this function;
- return `null` on user cancel;
- save returned handle under opaque adapterRef in IndexedDB;
- do not put handle in Zustand/localStorage/chat state;
- provide `queryBrowserGrant(adapterRef)` returning `"granted" | "prompt" | "denied" | "missing"`.

Use TypeScript-safe feature detection because File System Access types may not be in the current DOM lib configuration. Prefer local narrow interfaces over `any` spreading through the code.

- [ ] **Step 6: Implement SandboxAdapter identity/fallback state**

Part 1 only needs a stable adapter kind/capabilities and reserved IndexedDB namespace. Part 2 will implement actual file records. Do not duplicate existing course-material blob storage.

- [ ] **Step 7: GREEN + typecheck**

```bash
npx vitest run tests/unit/kiro-computer-store.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit workspace/grant control plane**

```bash
git add store/useKiroComputerStore.ts lib/ai/computer/adapters lib/ai/computer/workspace/grants.ts tests/unit/kiro-computer-store.test.ts
git commit -m "feat(kiro): add computer workspace grants"
```

---

### Task 3: Add Capability-Driven Reasoning Effort to Model Settings and Server Requests

**Files:**
- Create: `lib/ai/reasoning/types.ts`
- Create: `lib/ai/reasoning/providerOptions.ts`
- Modify: `lib/ai/providers/types.ts`
- Modify: `lib/ai/providers/capabilities.ts`
- Modify: built-in provider model registry files under `lib/ai/providers/`
- Modify: `store/useAISettingsStore.ts`
- Modify: `app/api/ai/chat/route.ts`
- Modify: request/body validation types used by route
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

Add to model definition capabilities:

```ts
reasoning?: ReasoningCapability;
```

Add to `AICustomConfig`:

```ts
reasoningEffort?: boolean;
```

Add to persisted `AISettings`:

```ts
reasoningEffort: KiroReasoningEffort;
```

Default = `"default"`.

- [ ] **Step 1: Inspect installed provider SDK types before coding mapping**

Use local code/type definitions, not memory:

```bash
grep -R "reasoningEffort\|effort.*low\|thinking.*budget" node_modules/@ai-sdk/openai-compatible node_modules/@ai-sdk/anthropic -n | head -80
```

Also inspect current `streamText` invocation and provider option naming in installed `ai` package types. Record the exact verified mapping in code comments.

Do not install packages.

- [ ] **Step 2: Write tests for normalization**

Tests must prove:
- missing reasoning capability resolves to `default` only;
- unsupported requested effort normalizes to `default` (or returns a typed unsupported result, but UI/server behavior must be consistent);
- `default` produces no provider override;
- DeepSeek official transport currently stays fixed/default because repository transform forcibly sets `thinking: { type: "disabled" }`;
- Custom OpenAI only becomes adjustable when user explicitly sets `custom.reasoningEffort === true`.

- [ ] **Step 3: RED run**

```bash
npx vitest run tests/unit/kiro-reasoning.test.ts
```

- [ ] **Step 4: Extend model capability metadata conservatively**

Rules:
- do not mark every `openai-chat` or `anthropic-messages` model adjustable automatically;
- mark only models for which the current transport/provider implementation has verified support;
- if no built-in OpenCode model can be proven adjustable from current provider behavior, leave them fixed for Part 1 rather than fabricate support;
- Custom OpenAI capability remains explicit user opt-in.

- [ ] **Step 5: Add persisted reasoning setting**

`useAISettingsStore` and `AISettings` gain `reasoningEffort` + `setReasoningEffort`. Existing persisted settings without the field must hydrate safely to `default` through store defaults/migration behavior.

- [ ] **Step 6: Implement server-side normalized mapping**

Client may send only `reasoningEffort`. It must never send arbitrary providerOptions.

Server flow:

```text
request reasoningEffort
→ resolve model definition
→ normalize against definition.capabilities.reasoning
→ resolve verified providerOptions
→ streamText(...)
```

If normalized effort is `default`, omit provider override.

Do not remove DeepSeek's existing request-body transform/schema fix.

- [ ] **Step 7: GREEN + typecheck**

```bash
npx vitest run tests/unit/kiro-reasoning.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit reasoning capability**

```bash
git add lib/ai/reasoning lib/ai/providers store/useAISettingsStore.ts app/api/ai/chat tests/unit/kiro-reasoning.test.ts
git commit -m "feat(kiro): add reasoning effort controls"
```

---

### Task 4: Freeze Computer/Reasoning Turn Snapshot and Establish Kiro Tool-Domain Hook

**Files:**
- Modify: `hooks/useKiroChat.ts`
- Modify: `lib/ai/contextBudget/types.ts` or the actual canonical turn-request snapshot type
- Modify: `app/api/ai/chat/route.ts`
- Modify: `lib/ai/tools/index.ts` or current server tool assembly
- Test: extend `tests/unit/kiro-reasoning.test.ts` and/or create one focused runtime snapshot test only if existing test seams require it.

**Turn snapshot:**

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

No `adapterRef`, handles, native paths, rules, or permission tokens are sent to the model/server context.

- [ ] **Step 1: Add request snapshot creation in `useKiroChat`**

At send boundary, capture:
- current selected model/provider;
- `reasoningEffort`;
- `computerEnabled`;
- active workspace logical metadata;
- `agentMode`.

A running turn must not change if the user later switches model/reasoning/mode/workspace in the store. The Composer already treats submitting/streaming as `turnLocked`; preserve that model.

- [ ] **Step 2: Keep live grants/rules out of snapshot**

Permission rules and grant revocation remain live client runtime state for future tool execution. Do not serialize them into the request as authority.

- [ ] **Step 3: Add server validation of logical Computer context**

Server treats it as context/tool-selection metadata only, not authority. Reject malformed IDs/oversized root arrays. Do not accept absolute paths.

- [ ] **Step 4: Add Computer tool-domain gating hook without exposing tools**

Part 1 may add:

```ts
resolveKiroToolDomains({ computerEnabled, agentMode })
```

or equivalent structure so Part 2 can register Computer tools cleanly. In Part 1, model-facing Computer file mutation tools must still be absent.

- [ ] **Step 5: Targeted test/typecheck**

Use existing test seam if present. Otherwise rely on reasoning/policy unit tests + typecheck; do not build a large chat integration harness solely for this snapshot.

```bash
npm run typecheck
```

- [ ] **Step 6: Commit turn snapshot integration**

```bash
git add hooks/useKiroChat.ts lib/ai/contextBudget app/api/ai/chat lib/ai/tools
git commit -m "feat(kiro): snapshot computer agent turn controls"
```

---

### Task 5: Productize Settings for Reasoning and Computer Agent

**Files:**
- Create: `components/settings/KiroAgentSettings.tsx`
- Modify: `components/settings/KiroAISettings.tsx`
- Modify: actual Settings navigation/registry discovered by grep
- Modify: `lib/ai/providers/types.ts` / Custom provider UI as required

**Settings ownership:**
- `KiroAISettings`: Provider, Model, Reasoning Effort, Answer Preference, Search/Vision, Memory/privacy as currently appropriate.
- `KiroAgentSettings`: Computer enable, default Agent Mode, Workspaces, Authorized roots, grant status, reauthorize/remove, permission-rule summary/future system capability labels.

- [ ] **Step 1: Add Reasoning row inside existing Model group**

Display:
- `默认 / 低 / 中 / 高` only when active model supports those efforts;
- unsupported current model: disabled neutral control/copy such as `当前模型不可调`;
- keep `回答偏好` under Answer section with copy explicitly stating it changes final expression depth, not model reasoning.

For Custom OpenAI advanced capabilities add an explicit checkbox:

```text
支持思考程度
```

It only enables the Kiro reasoning control; it does not bypass server normalization.

- [ ] **Step 2: Build `KiroAgentSettings`**

Use existing Settings primitives and groups. Required rows:

```text
Computer Agent                       ON/OFF
默认权限模式                          计划 / 受控 / 工作区自动
当前 Workspace                       name / 未配置
授权位置                              roots list + read-only/read-write state
添加位置                              user-gesture action
活动与安全                            explain local authorization / no shell/delete in V1
桌面能力                              Full Access / terminal = 桌面版后续支持
```

When File System Access is unsupported, show `Kiro Sandbox（当前浏览器）` and permit logical Sandbox workspace creation without pretending it is a native folder.

- [ ] **Step 3: First-enable flow**

Turning Computer Agent ON with no workspace must not silently create native access. UI should guide user to:
- choose a real folder on supported Chromium, or
- create/use Kiro Sandbox fallback.

If user cancels folder picker, Computer remains disabled unless they explicitly select Sandbox.

- [ ] **Step 4: Reauthorization state**

For roots whose grant is `prompt/denied/missing`, show a clear state and user-triggered reauthorization/manage action. Background Kiro execution cannot open the picker.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit settings surfaces**

```bash
git add components/settings lib/ai/providers/types.ts
git commit -m "feat(kiro): add agent and reasoning settings"
```

---

### Task 6: Redesign Kiro Composer Computer Mode with Codex-Inspired Information Hierarchy

**Files:**
- Create: `components/kiro/computer/KiroWorkspacePicker.tsx`
- Create: `components/kiro/computer/KiroAgentModeMenu.tsx`
- Create: `components/kiro/computer/KiroReasoningMenu.tsx`
- Modify: `components/kiro/KiroComposer.tsx`
- Modify: Composer owner component that supplies model/settings state
- Test: existing focused Kiro E2E or create `tests/e2e/kiro-computer-controls.spec.ts`

**Visual/interaction direction:**

Computer Agent ON:

```text
┌──────────────────────────────────────────────────────────────┐
│ [论文研究]  [本地 / Sandbox]                                 │
│                                                              │
│ Ask Kiro…                                                    │
│                                                              │
│ +   @   Web   Computer ✓             [受控] [思考 中] [模型] ↑ │
└──────────────────────────────────────────────────────────────┘
```

This borrows Codex's hierarchy from the supplied reference: context/workspace state is visible but quiet near the top edge; the main prompt area stays clean; execution controls cluster near send. Do not add a Git branch chip because ClassFlow V1 has no branch semantics.

Normal Computer OFF mode should remain close to current Kiro Composer and must not show a meaningless permission-mode chip.

- [ ] **Step 1: Replace ad-hoc new menus with existing shared Popover/Dropdown primitives**

Use the UI primitives already established in Task 2B1. Do not create new outside-click/Escape menu infrastructure.

- [ ] **Step 2: Add Computer toggle**

Use a low-noise desktop/computer icon. States:
- OFF: neutral;
- ON: pastel-mint active treatment consistent with Web Search;
- disabled while `turnLocked`.

If enabling requires workspace setup, invoke the controlled workspace setup flow; do not toggle true before a valid workspace/sandbox is selected.

- [ ] **Step 3: Add workspace/context strip**

Only visible when Computer Agent is enabled. Show:
- active workspace name;
- adapter label `本地` or `Sandbox`;
- grant warning when current workspace is not executable.

Keep ClassFlow context chips/attachments as the existing context system; do not duplicate them into this strip.

- [ ] **Step 4: Add Agent Mode control**

Options and copy:

```text
计划       只读取和分析，不修改文件
受控       可创建；修改前询问
工作区自动 在授权 Workspace 内自动创建/修改；危险能力仍禁用
```

Control is visible only when Computer Agent is ON. Changing mode updates `useKiroComputerStore`. Disable while turnLocked.

- [ ] **Step 5: Add Reasoning control**

Show a compact control only if current model capability has >1 supported effort. If not adjustable, omit the Composer chip rather than clutter it with a disabled control; Settings still explains capability.

Labels:

```text
默认
思考 低
思考 中
思考 高
```

Changing it updates the same `useAISettingsStore.reasoningEffort` that Settings consumes.

- [ ] **Step 6: Keep Model + Send hierarchy stable**

Desktop right-side order:

```text
Agent Mode → Reasoning → Model → Send
```

If Computer OFF:

```text
Reasoning → Model → Send
```

On compact/sidecar widths, collapse text labels to icons/tooltips or shorter labels without wrapping the toolbar. Do not remove the model selector.

- [ ] **Step 7: Preserve current attachment/context/Web Search behavior**

Do not regress:
- `+` attachment picker;
- `@` ClassFlow context picker;
- web search toggle;
- image/PDF vision blocking;
- send/stop/submitting states;
- model unavailable flow;
- drag/drop/paste attachment flows.

- [ ] **Step 8: Add one focused E2E file/case**

Prefer a single file with one flow:
1. open Kiro;
2. verify Computer OFF initially;
3. choose Sandbox setup in test environment (do not depend on native directory picker in Playwright CI);
4. Computer becomes ON;
5. switch `受控 → 计划` and verify active/selected state;
6. if fixture model is reasoning-adjustable, switch reasoning and verify selected state; otherwise verify no misleading reasoning chip;
7. open Settings and verify Agent Mode/Reasoning reflect same store values;
8. return to Kiro and verify values remain synchronized.

Do not test actual file writes in Part 1.

Run only:

```bash
npx playwright test tests/e2e/kiro-computer-controls.spec.ts
```

If a pre-existing focused file is reused, run only that file.

- [ ] **Step 9: Final typecheck**

```bash
npm run typecheck
```

- [ ] **Step 10: Commit Composer productization**

```bash
git add components/kiro components/settings tests/e2e
git commit -m "feat(kiro): add computer agent composer controls"
```

---

### Task 7: Part 1 Static Audit and Verification

**Files:** No new feature files unless fixes are required.

- [ ] **Step 1: Audit trust-boundary leakage**

Search:

```bash
grep -R "showDirectoryPicker\|FileSystemDirectoryHandle\|adapterRef\|reasoningEffort\|computerEnabled\|workspace-auto" hooks app lib store components -n
```

Confirm:
- `showDirectoryPicker` only appears in explicit UI/grant helper code;
- native handles do not appear in `useAISettingsStore`, `useKiroComputerStore` persistence, chat request types, or history serializers;
- raw providerOptions are not accepted from client request;
- `useKiroChat.ts` contains routing/snapshot assembly but no Computer filesystem execution logic;
- Computer model-facing tool schemas are not exposed yet in Part 1.

- [ ] **Step 2: Run only required unit files together**

```bash
npx vitest run \
  tests/unit/kiro-computer-policy.test.ts \
  tests/unit/kiro-computer-store.test.ts \
  tests/unit/kiro-reasoning.test.ts
```

If the store test was folded into policy due existing project conventions, run the actual two focused files only.

- [ ] **Step 3: Run the single focused E2E file**

```bash
npx playwright test tests/e2e/kiro-computer-controls.spec.ts
```

Skip if the environment cannot start the app and report the exact infrastructure blocker; do not substitute a full suite.

- [ ] **Step 4: Final typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Build policy**

Default: skip `npm run build`.

Run build only if Part 1 introduced a Client/Server import boundary issue, Next route compile-only issue, or TypeScript DOM/File System Access type issue not caught by `typecheck`.

- [ ] **Step 6: Final acceptance audit**

Part 1 is complete only if all are true:
- independent Computer Runtime exists;
- policy modes and hard-deny behavior exist;
- workspace logical metadata is persisted separately from native grants;
- supported Chromium has explicit user-gesture directory grant path;
- unsupported browser has Sandbox fallback path;
- Reasoning Effort is separate from response preference;
- unsupported models are not falsely shown as adjustable;
- current DeepSeek forced-thinking-disabled compatibility is preserved;
- reasoning/model/mode/workspace are frozen at turn start;
- live grants/rules are not serialized as authority;
- Composer and Settings share the same reasoning/mode stores;
- Computer mode Composer uses Codex-inspired hierarchy without copying Codex branding/branch semantics;
- no Computer file mutation tools are exposed yet;
- shell/delete/app/MCP/full-access remain unavailable;
- existing attachment/context/Web Search/model/send flows remain intact.

- [ ] **Step 7: Final report and STOP**

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
- supported transports/models
- unsupported/fixed behavior

UI:
- Composer Computer mode
- Agent Mode
- Reasoning
- Workspace indicator
- Settings sections

Turn integration:
- frozen snapshot fields
- live state intentionally excluded

Verification:
- targeted unit files
- targeted E2E file
- typecheck
- build: PASS / skipped by policy

Deferred to Part 2:
- list/search/grep/read model-facing Computer tools
- create directory/text/document
- patch text
- Markdown/DOCX render/verify
- File Action Cards for real mutations
```

STOP. Do not begin Part 2.
