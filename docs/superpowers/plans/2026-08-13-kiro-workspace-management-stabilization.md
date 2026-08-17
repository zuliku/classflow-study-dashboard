# Kiro Workspace Management Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Kiro Computer Agent V1 workspace management by preventing duplicate default Sandboxes, adding safe Workspace deletion/cleanup, persisting the active Workspace, and replacing oversized authorization cards with a compact management list.

**Architecture:** Keep `useKiroComputerStore` as the logical Workspace source of truth and keep native/browser handles outside Zustand. Settings deletion coordinates logical removal plus adapter cleanup; the store owns deterministic active-workspace fallback, canonical default Sandbox reuse, permission-rule cleanup, and persisted-state migration. The default Kiro Sandbox remains a single canonical browser-local Workspace in V1.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand persist, IndexedDB, File System Access API, existing Button/IconButton/ConfirmDialog primitives, Vitest, Playwright.

## Global Constraints

- Do not add any model-facing delete/move/shell/app tool.
- Workspace deletion is an explicit Settings action only.
- Deleting a Browser Workspace forgets ClassFlow's stored grant record and never deletes files from the user's real folder.
- Deleting the default Sandbox clears only that Sandbox adapter namespace from `classflow-kiro-sandbox-v1`.
- Clean an `adapterRef` only when no remaining Workspace references it.
- `FileSystemDirectoryHandle`, native paths, file bytes, adapter cleanup internals, and permission tokens must not enter model context/history.
- Preserve Part 3 approval/task/checkpoint/history behavior.
- Run only focused unit tests, the existing Computer controls E2E, and typecheck. Skip full suites/build by default.

---

## File Map

### Create
- `lib/ai/computer/workspace/management.ts`
- `tests/unit/kiro-workspace-management.test.ts`

### Modify
- `store/useKiroComputerStore.ts`
- `lib/ai/computer/adapters/sandbox.ts`
- `lib/ai/computer/workspace/grants.ts`
- `components/kiro/KiroChatSurface.tsx`
- `components/settings/KiroAgentSettings.tsx`
- `tests/unit/kiro-computer-store.test.ts`
- `tests/e2e/kiro-computer-controls.spec.ts`

---

## Task 1: Canonical Workspace Lifecycle and Storage Cleanup

**Interfaces:**

```ts
// lib/ai/computer/workspace/management.ts
export const DEFAULT_SANDBOX_ADAPTER_REF = "sandbox-default";

export function isDefaultSandboxWorkspace(workspace: KiroWorkspaceMeta): boolean;

export function adapterRefStillReferenced(
  workspaces: KiroWorkspaceMeta[],
  adapterRef: string
): boolean;

// sandbox.ts
export async function clearSandboxAdapter(adapterRef: string): Promise<void>;

// grants.ts
export async function forgetBrowserWorkspaceGrant(adapterRef: string): Promise<void>;
```

Extend `KiroComputerState`:

```ts
ensureDefaultSandboxWorkspace: () => string;
```

### Step 1 — Write failing store tests

Append to `tests/unit/kiro-computer-store.test.ts`:

```ts
it("ensureDefaultSandboxWorkspace reuses one canonical Sandbox", () => {
  const first = useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
  const second = useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();

  expect(second).toBe(first);
  const state = useKiroComputerStore.getState();
  expect(state.activeWorkspaceId).toBe(first);
  expect(state.computerEnabled).toBe(true);
  expect(
    state.workspaces.filter((w) =>
      w.roots.some((r) => r.adapterRef === "sandbox-default")
    )
  ).toHaveLength(1);
});

it("removing active Workspace selects next remaining Workspace", () => {
  const store = useKiroComputerStore.getState();
  store.addWorkspace(ws("a", "A"));
  store.addWorkspace(ws("b", "B"));
  store.setActiveWorkspaceId("a");
  store.setComputerEnabled(true);

  useKiroComputerStore.getState().removeWorkspace("a");

  const state = useKiroComputerStore.getState();
  expect(state.activeWorkspaceId).toBe("b");
  expect(state.computerEnabled).toBe(true);
});

it("removing last Workspace disables Computer Agent", () => {
  const store = useKiroComputerStore.getState();
  store.addWorkspace(ws("only", "Only"));
  store.setActiveWorkspaceId("only");
  store.setComputerEnabled(true);

  useKiroComputerStore.getState().removeWorkspace("only");

  const state = useKiroComputerStore.getState();
  expect(state.workspaces).toEqual([]);
  expect(state.activeWorkspaceId).toBeNull();
  expect(state.computerEnabled).toBe(false);
});

it("removing Workspace removes only permission rules scoped to it", () => {
  const store = useKiroComputerStore.getState();
  store.addWorkspace(ws("a", "A"));
  store.addWorkspace(ws("b", "B"));
  store.upsertPermissionRule({
    id: "a-persistent",
    effect: "allow",
    capability: "fs.modify",
    workspaceId: "a",
    scope: "persistent",
  });
  store.upsertPermissionRule({
    id: "a-session",
    effect: "allow",
    capability: "fs.modify",
    workspaceId: "a",
    scope: "session",
  });
  store.upsertPermissionRule({
    id: "b-rule",
    effect: "allow",
    capability: "fs.modify",
    workspaceId: "b",
    scope: "persistent",
  });

  useKiroComputerStore.getState().removeWorkspace("a");

  expect(useKiroComputerStore.getState().permissionRules.map((r) => r.id)).toEqual([
    "b-rule",
  ]);
});

it("persisted state includes activeWorkspaceId", () => {
  const store = useKiroComputerStore.getState();
  store.addWorkspace(ws("research", "论文研究"));
  store.setActiveWorkspaceId("research");

  const persisted = useKiroComputerStore.persist.getOptions().partialize?.(
    useKiroComputerStore.getState()
  ) as { activeWorkspaceId?: string | null };

  expect(persisted.activeWorkspaceId).toBe("research");
});
```

### Step 2 — Write failing management helper tests

Create `tests/unit/kiro-workspace-management.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { KiroWorkspaceMeta } from "@/lib/ai/computer/types";
import {
  DEFAULT_SANDBOX_ADAPTER_REF,
  adapterRefStillReferenced,
  isDefaultSandboxWorkspace,
} from "@/lib/ai/computer/workspace/management";

const makeWorkspace = (id: string, adapterRef: string): KiroWorkspaceMeta => ({
  id,
  name: id,
  roots: [
    {
      id: `${id}-root`,
      label: id,
      access: "read-write",
      adapterRef,
    },
  ],
  createdAt: "2026-08-13T00:00:00.000Z",
  updatedAt: "2026-08-13T00:00:00.000Z",
});

describe("workspace management helpers", () => {
  it("detects only the canonical default Sandbox", () => {
    expect(
      isDefaultSandboxWorkspace(makeWorkspace("sandbox", DEFAULT_SANDBOX_ADAPTER_REF))
    ).toBe(true);
    expect(isDefaultSandboxWorkspace(makeWorkspace("browser", "browser-grant-1"))).toBe(false);
  });

  it("detects shared adapter references", () => {
    const a = makeWorkspace("a", "shared");
    const b = makeWorkspace("b", "shared");
    const c = makeWorkspace("c", "unique");

    expect(adapterRefStillReferenced([a, b, c], "shared")).toBe(true);
    expect(adapterRefStillReferenced([a, b], "unique")).toBe(false);
  });
});
```

### Step 3 — Confirm RED

```bash
npx vitest run tests/unit/kiro-computer-store.test.ts tests/unit/kiro-workspace-management.test.ts
```

### Step 4 — Implement canonical default Sandbox

Create `management.ts` with the exact interfaces above. In `useKiroComputerStore`, change `create((set) =>` to `create((set, get) =>` and implement `ensureDefaultSandboxWorkspace()`:

```text
find existing Workspace whose roots contain sandbox-default
if found:
  set activeWorkspaceId = existing.id
  set computerEnabled = true
  return existing.id
otherwise:
  create one Workspace named "Kiro Sandbox"
  root label = "Sandbox（当前浏览器）"
  root access = "read-write"
  adapterRef = "sandbox-default"
  add + activate + enable atomically
  return new id
```

Do not create a second default Sandbox.

### Step 5 — Harden removeWorkspace

Implement deterministic removal:

```ts
removeWorkspace: (id) =>
  set((state) => {
    const remaining = state.workspaces.filter((w) => w.id !== id);
    const currentStillExists = remaining.some((w) => w.id === state.activeWorkspaceId);
    const activeWorkspaceId = currentStillExists
      ? state.activeWorkspaceId
      : remaining[0]?.id ?? null;

    return {
      workspaces: remaining,
      activeWorkspaceId,
      computerEnabled: remaining.length === 0 ? false : state.computerEnabled,
      permissionRules: state.permissionRules.filter((r) => r.workspaceId !== id),
    };
  }),
```

### Step 6 — Persist active Workspace + migrate legacy duplicates

Set persist `version: 2` and add a `migrate` function. For states with version `< 2`:

1. find every Workspace containing `adapterRef === "sandbox-default"`;
2. keep the first one;
3. drop later duplicate Workspace metadata only;
4. if `activeWorkspaceId` points at a dropped duplicate, remap it to the kept id;
5. drop permission rules whose `workspaceId` belongs to dropped duplicate ids;
6. do **not** delete Sandbox files during migration because those legacy entries all share one namespace.

Add `activeWorkspaceId` to `partialize`.

### Step 7 — Add Sandbox namespace cleanup

In `sandbox.ts` implement:

```ts
export async function clearSandboxAdapter(adapterRef: string): Promise<void>
```

Open `classflow-kiro-sandbox-v1/files` readwrite and delete keys in the bounded range:

```ts
const prefix = `${adapterRef}\u0000`;
const range = IDBKeyRange.bound(prefix, `${prefix}\uffff`);
```

Use a cursor and `cursor.delete()`. Do not delete the full database.

### Step 8 — Add Browser grant forgetting

In `workspace/grants.ts` implement:

```ts
export async function forgetBrowserWorkspaceGrant(adapterRef: string): Promise<void>
```

Delete only `adapterRef` from `classflow-kiro-grants-v1/handles`. Never call the native directory handle's `remove()` method and never touch files inside the real folder.

### Step 9 — Make Composer use the canonical Sandbox helper

In `KiroChatSurface.tsx`, replace the manual Sandbox Workspace object construction inside Computer enable flow with:

```ts
useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
```

Do not duplicate default Sandbox creation logic anywhere else.

### Step 10 — Run focused unit tests GREEN

```bash
npx vitest run tests/unit/kiro-computer-store.test.ts tests/unit/kiro-workspace-management.test.ts
```

### Step 11 — Commit

```bash
git add store/useKiroComputerStore.ts lib/ai/computer/workspace/management.ts lib/ai/computer/workspace/grants.ts lib/ai/computer/adapters/sandbox.ts components/kiro/KiroChatSurface.tsx tests/unit/kiro-computer-store.test.ts tests/unit/kiro-workspace-management.test.ts
git commit -m "fix(kiro): stabilize computer workspace lifecycle"
```

---

## Task 2: Compact Settings Workspace Management UI

### Step 1 — Extend existing E2E before implementation

Modify `tests/e2e/kiro-computer-controls.spec.ts` after the existing Kiro Agent Settings assertions.

Use the existing Sandbox created earlier in the test and add:

```ts
const workspaceRows = page.getByTestId("kiro-workspace-row");
await expect(workspaceRows).toHaveCount(1);
await expect(workspaceRows.first()).toContainText("Kiro Sandbox");
await expect(workspaceRows.first()).toContainText("当前");
await expect(workspaceRows.first()).toContainText("Sandbox");
await expect(workspaceRows.first()).toContainText("读写");
await expect(
  workspaceRows.first().getByRole("button", { name: /删除工作区/ })
).toBeVisible();
```

To verify the Sandbox action cannot duplicate, expose the Settings action with accessible name `使用 Kiro Sandbox` only when no default Sandbox exists. Therefore after one Sandbox exists:

```ts
await expect(page.getByRole("button", { name: "使用 Kiro Sandbox" })).toHaveCount(0);
```

Then verify deletion of the last Sandbox:

```ts
await workspaceRows.first().getByRole("button", { name: /删除工作区/ }).click();
await expect(page.getByRole("alertdialog")).toContainText("删除 Kiro Sandbox");
await page.getByRole("button", { name: "删除" }).click();
await expect(workspaceRows).toHaveCount(0);
await expect(page.getByRole("switch", { name: "Computer Agent" })).toHaveAttribute(
  "aria-checked",
  "false"
);
```

### Step 2 — Confirm E2E RED

```bash
npx playwright test tests/e2e/kiro-computer-controls.spec.ts
```

### Step 3 — Redesign each Workspace into one compact row

In `KiroAgentSettings.tsx`, replace the current large card + badge row + root row layout with:

```text
[icon] Kiro Sandbox                         [当前] [trash]
       Sandbox（当前浏览器） · Sandbox · 读写
```

Browser example:

```text
[icon] Research                       [设为当前] [trash]
       Research · 本地 · 已授权 · 读写
```

Use one surface per Workspace:

```text
rounded-xl border border-line bg-surface px-3 py-2.5
```

Only `当前` remains a badge. Render `Sandbox/本地 · 授权状态 · 读写/只读` as muted inline metadata rather than separate pills.

Each row:

```tsx
<div
  data-testid="kiro-workspace-row"
  data-workspace-id={ws.id}
  ...
/>
```

### Step 4 — Add explicit current selection

For non-current Workspace rows render a compact secondary/ghost `设为当前` button calling only:

```ts
setActiveWorkspaceId(ws.id)
```

For the active Workspace render the `当前` badge instead.

### Step 5 — Add discoverable delete action

Import `Trash2`, `IconButton`, `useConfirmStore`, `useToastStore`, `clearSandboxAdapter`, `forgetBrowserWorkspaceGrant`, and the management helpers.

Every row gets:

```tsx
<IconButton
  variant="ghost"
  size="sm"
  aria-label={`删除工作区 ${ws.name}`}
  ...
>
  <Trash2 className="w-3.5 h-3.5" />
</IconButton>
```

Sandbox confirmation:

```text
Title: 删除 Kiro Sandbox？
Description: 此操作会删除该 Sandbox 在当前浏览器中保存的文件和工作区记录，无法撤销。
Confirm label: 删除
Danger: true
```

Browser confirmation:

```text
Title: 移除本地工作区？
Description: ClassFlow 将忘记这个文件夹的授权记录，但不会删除电脑上的任何文件。
Confirm label: 移除
Danger: true
```

On confirm:

```text
snapshot removed Workspace
compute remaining Workspaces before cleanup
removeWorkspace(ws.id)
for each unique adapterRef in removed Workspace:
  if remaining Workspaces still reference it -> do nothing
  else if sandbox adapter -> clearSandboxAdapter(adapterRef)
  else -> forgetBrowserWorkspaceGrant(adapterRef)
if cleanup rejects -> keep logical Workspace removed and push error toast
```

Do not expose this Settings deletion path as an Agent tool.

### Step 6 — Prevent Sandbox duplication in Settings

Replace `handleUseSandbox()` body with:

```ts
useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
setGrantStatus((s) => ({ ...s, "sandbox-default": "granted" }));
```

Render `使用 Kiro Sandbox` only when there is no canonical default Sandbox. When it exists, the Workspace row itself is the management surface.

Keep `添加本地位置` available.

### Step 7 — Fix stale copy

Replace the now-false description:

```text
开启后 Kiro 可在授权工作区内执行受限操作（V1：不包含文件写入工具）。
```

with:

```text
开启后 Kiro 可在授权工作区内读取、创建和受控修改文件；危险系统能力仍保持禁用。
```

### Step 8 — Run targeted E2E GREEN

```bash
npx playwright test tests/e2e/kiro-computer-controls.spec.ts
```

### Step 9 — Final typecheck

```bash
npm run typecheck
```

Do not run `npm run build` unless typecheck exposes a Next/client boundary issue that requires build-only verification.

### Step 10 — Commit

```bash
git add components/settings/KiroAgentSettings.tsx tests/e2e/kiro-computer-controls.spec.ts
git commit -m "fix(kiro): productize workspace management"
```

---

## Final Self-Review

- [ ] Default Sandbox cannot be duplicated from Composer or Settings.
- [ ] Legacy duplicate `sandbox-default` metadata is deduplicated without deleting shared files.
- [ ] `activeWorkspaceId` persists.
- [ ] Removing current Workspace selects the next remaining Workspace.
- [ ] Removing the last Workspace disables Computer Agent.
- [ ] Workspace-scoped permission rules disappear with the Workspace.
- [ ] Sandbox deletion clears only an unreferenced Sandbox namespace.
- [ ] Browser deletion forgets only ClassFlow's handle record and never deletes real files.
- [ ] Shared adapter references are never cleaned while still referenced.
- [ ] Settings uses compact rows, not oversized nested cards/badge groups.
- [ ] Every Workspace has an explicit delete action.
- [ ] Non-current Workspaces can be selected explicitly.
- [ ] No new model-facing delete tool exists.
- [ ] Part 3 approval/task/history/checkpoint behavior remains unchanged.
- [ ] Focused unit tests pass.
- [ ] `kiro-computer-controls.spec.ts` passes.
- [ ] `npm run typecheck` passes.
