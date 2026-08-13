# Kiro Workspace Management Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Kiro Computer Agent V1 workspace management by preventing duplicate default Sandboxes, adding safe Workspace deletion/cleanup, persisting the active Workspace, and replacing the oversized authorization cards with a compact productized management list.

**Architecture:** Keep `useKiroComputerStore` as the logical Workspace source of truth and keep native/browser handles outside Zustand. Introduce explicit runtime cleanup helpers for Sandbox namespaces and Browser grant records; settings deletion coordinates logical removal plus adapter cleanup, while the store owns deterministic active-workspace fallback and permission-rule cleanup. The default Kiro Sandbox remains a single canonical browser-local Workspace in V1.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand persist, IndexedDB, File System Access API, existing Button/IconButton/ConfirmDialog primitives, Vitest, Playwright.

## Global Constraints

- Do not add new model-facing Computer tools.
- Do not expose delete filesystem capability to the LLM; Workspace deletion is an explicit Settings action only.
- Deleting a local Browser Workspace forgets the stored grant handle but never deletes files from the user's real folder.
- Deleting a Sandbox Workspace deletes only that Sandbox adapter namespace from `classflow-kiro-sandbox-v1`.
- Cleanup of an adapterRef may happen only when no remaining Workspace references that adapterRef.
- `FileSystemDirectoryHandle`, native paths, file bytes, adapter cleanup internals, and permission tokens must not enter model context/history.
- Existing Computer approval/task/checkpoint/history behavior must remain unchanged.
- Test only the focused store/workspace lifecycle and existing Computer controls E2E; skip full suites/build by default.

---

## File Map

### Create
- `lib/ai/computer/workspace/management.ts` — pure helpers for canonical default Sandbox detection, shared-adapter reference checks, and logical Workspace display metadata.
- `tests/unit/kiro-workspace-management.test.ts` — cleanup/reference/dedup helpers.

### Modify
- `store/useKiroComputerStore.ts` — canonical Sandbox creation/reuse, deterministic removal fallback, activeWorkspace persistence, stale permission cleanup, persist migration.
- `lib/ai/computer/adapters/sandbox.ts` — add `clearSandboxAdapter(adapterRef)` that deletes all entries for one adapter namespace only.
- `lib/ai/computer/workspace/grants.ts` — add `forgetBrowserWorkspaceGrant(adapterRef)` to delete only the IndexedDB handle record.
- `components/settings/KiroAgentSettings.tsx` — compact Workspace rows, select-current, delete action with ConfirmDialog, deduplicated Sandbox action.
- `components/kiro/KiroChatSurface.tsx` — use store canonical Sandbox helper instead of creating a second implementation.
- `tests/unit/kiro-computer-store.test.ts` — active fallback/persistence/canonical Sandbox behavior.
- `tests/e2e/kiro-computer-controls.spec.ts` — compact layout + duplicate prevention + deletion flow.

---

### Task 1: Fix Workspace Lifecycle and Adapter Cleanup

**Files:**
- Create: `lib/ai/computer/workspace/management.ts`
- Modify: `store/useKiroComputerStore.ts`
- Modify: `lib/ai/computer/adapters/sandbox.ts`
- Modify: `lib/ai/computer/workspace/grants.ts`
- Modify: `components/kiro/KiroChatSurface.tsx`
- Test: `tests/unit/kiro-computer-store.test.ts`
- Test: `tests/unit/kiro-workspace-management.test.ts`

**Interfaces:**

```ts
export const DEFAULT_SANDBOX_ADAPTER_REF = "sandbox-default";

export function isDefaultSandboxWorkspace(workspace: KiroWorkspaceMeta): boolean;

export function adapterRefStillReferenced(
  workspaces: KiroWorkspaceMeta[],
  adapterRef: string
): boolean;

export async function clearSandboxAdapter(adapterRef: string): Promise<void>;

export async function forgetBrowserWorkspaceGrant(adapterRef: string): Promise<void>;
```

Extend `KiroComputerState` with:

```ts
ensureDefaultSandboxWorkspace: () => string;
```

The helper must atomically:

1. find an existing Workspace containing `adapterRef === "sandbox-default"`;
2. if found, make it active and enable Computer Agent, then return its id;
3. otherwise create exactly one `Kiro Sandbox`, make it active, enable Computer Agent, and return its id.

- [ ] **Step 1: Add failing store tests**

Add exact expectations:

```ts
it("ensureDefaultSandboxWorkspace reuses the existing sandbox", () => {
  const id1 = useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
  const id2 = useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
  expect(id2).toBe(id1);
  expect(
    useKiroComputerStore.getState().workspaces.filter((w) =>
      w.roots.some((r) => r.adapterRef === "sandbox-default")
    )
  ).toHaveLength(1);
});

it("removing active workspace selects the next workspace", () => {
  // add a + b, active a, remove a
  // expect activeWorkspaceId === b and Computer remains enabled
});

it("removing the last workspace disables Computer Agent", () => {
  // one workspace, enabled=true, remove it
  // expect activeWorkspaceId === null and computerEnabled === false
});

it("removing a workspace removes permission rules scoped to it", () => {
  // workspace-specific session + persistent rules disappear; unrelated rules remain
});

it("persisted state includes activeWorkspaceId", () => {
  // partialize result contains the logical active id
});
```

- [ ] **Step 2: Add failing workspace-management tests**

Cover:

```ts
expect(isDefaultSandboxWorkspace(defaultSandbox)).toBe(true);
expect(isDefaultSandboxWorkspace(browserWorkspace)).toBe(false);
expect(adapterRefStillReferenced([a, b], "shared")).toBe(true);
expect(adapterRefStillReferenced([b], "only-a")).toBe(false);
```

- [ ] **Step 3: Run only the two unit files and confirm RED**

```bash
npx vitest run tests/unit/kiro-computer-store.test.ts tests/unit/kiro-workspace-management.test.ts
```

- [ ] **Step 4: Implement canonical Sandbox lifecycle in the Store**

Use Zustand `(set, get)` so `ensureDefaultSandboxWorkspace()` can return the selected id. Generate a new logical workspace id only when no default Sandbox exists. Keep the adapter ref canonical as `sandbox-default` for compatibility with existing data.

Change `removeWorkspace(id)` semantics to:

```text
remaining = all workspaces except id
if removed id was active:
  active = remaining[0]?.id ?? null
else:
  keep current active if it still exists
computerEnabled = remaining.length === 0 ? false : current computerEnabled
permissionRules = remove every rule with workspaceId === id
```

- [ ] **Step 5: Persist activeWorkspaceId and add persist migration**

Bump Zustand persist version to `2` and add `migrate`.

Migration for legacy duplicate default Sandboxes:

```text
find every workspace that references sandbox-default
keep the first canonical entry
remove later duplicate metadata entries only
if persisted activeWorkspaceId points to a removed duplicate, remap it to the canonical id
remove permission rules scoped to removed duplicate workspace ids
```

Do not delete Sandbox files during migration because legacy duplicate metadata references the same adapter namespace.

`partialize` must now include:

```ts
activeWorkspaceId: state.activeWorkspaceId
```

- [ ] **Step 6: Add Sandbox namespace cleanup**

Implement `clearSandboxAdapter(adapterRef)` using one readwrite IndexedDB cursor over keys bounded by:

```ts
`${adapterRef}\u0000`
```

to:

```ts
`${adapterRef}\u0000\uffff`
```

Delete only keys in that namespace. Do not delete the entire IndexedDB database.

- [ ] **Step 7: Add Browser grant forgetting**

Implement:

```ts
export async function forgetBrowserWorkspaceGrant(adapterRef: string): Promise<void>
```

Delete only that key from the existing `handles` object store. This forgets ClassFlow's stored handle only; it does not and cannot delete/revoke the user's real folder contents.

- [ ] **Step 8: Remove duplicate Sandbox construction from KiroChatSurface**

Replace its manual `addWorkspace({ name: "Kiro Sandbox", ... })` block with:

```ts
useKiroComputerStore.getState().ensureDefaultSandboxWorkspace();
```

The Composer toggle and Settings must therefore share the same canonical Sandbox behavior.

- [ ] **Step 9: Run the two unit files GREEN**

```bash
npx vitest run tests/unit/kiro-computer-store.test.ts tests/unit/kiro-workspace-management.test.ts
```

- [ ] **Step 10: Commit**

```bash
git add store/useKiroComputerStore.ts lib/ai/computer/workspace/management.ts lib/ai/computer/workspace/grants.ts lib/ai/computer/adapters/sandbox.ts components/kiro/KiroChatSurface.tsx tests/unit/kiro-computer-store.test.ts tests/unit/kiro-workspace-management.test.ts
git commit -m "fix(kiro): stabilize computer workspace lifecycle"
```

---

### Task 2: Productize Authorization Workspace Management UI

**Files:**
- Modify: `components/settings/KiroAgentSettings.tsx`
- Modify: `tests/e2e/kiro-computer-controls.spec.ts`

**Produces:** compact manageable Workspace rows with explicit current/delete actions and no duplicate Sandbox creation.

- [ ] **Step 1: Extend the existing E2E with failing Workspace-management assertions**

Continue using the CI-friendly Sandbox flow. Verify:

```text
1. Enable Computer -> exactly one Kiro Sandbox row.
2. Open Settings / Kiro Agent.
3. Workspace row has name, compact metadata, current state, and delete button.
4. Trigger the Sandbox action again -> still exactly one Sandbox row.
5. Add a second logical test Workspace only through store/init fixture if needed; selecting it changes Current state.
6. Delete the non-current Workspace -> remaining Workspace unaffected.
7. Delete current/last Sandbox -> confirmation appears; confirm -> Workspace list becomes empty and Computer switch becomes OFF.
```

Use semantic locators/data-testid; do not screenshot diff.

- [ ] **Step 2: Run only the Computer controls E2E and confirm RED**

```bash
npx playwright test tests/e2e/kiro-computer-controls.spec.ts
```

- [ ] **Step 3: Replace oversized cards with compact Workspace rows**

Each Workspace should be one compact row, not a card containing several badge rows.

Target hierarchy:

```text
[icon]  Kiro Sandbox                         [当前] [删除]
        Sandbox（当前浏览器） · Sandbox · 读写
```

For Browser Workspace:

```text
[icon]  Research                             [设为当前] [删除]
        Research · 本地 · 已授权 · 读写
```

Use:

```text
rounded-xl border border-line bg-surface px-3 py-2.5
```

No nested bordered badge container. Keep only `当前` as a visual badge; render Sandbox/本地、授权状态、读写 as muted inline metadata separated by `·`.

Rows should expose:

```text
data-testid="kiro-workspace-row"
data-workspace-id={ws.id}
```

- [ ] **Step 4: Add explicit Set Current action**

For non-active rows render a small secondary/ghost action:

```text
设为当前
```

It calls `setActiveWorkspaceId(ws.id)` only. It must not modify permissions or adapter grants.

For active row show the compact `当前` badge instead.

- [ ] **Step 5: Add explicit Delete action with confirmation**

Use existing `useConfirmStore` / shared ConfirmDialog lifecycle.

Sandbox copy:

```text
删除 Kiro Sandbox？
此操作会删除该 Sandbox 在当前浏览器中保存的文件和工作区记录，无法撤销。
```

Browser copy:

```text
移除本地工作区？
ClassFlow 将忘记这个文件夹的授权记录，但不会删除电脑上的任何文件。
```

On confirm:

1. snapshot the Workspace and remaining Workspace list;
2. `removeWorkspace(ws.id)`;
3. for each unique root adapterRef of the removed Workspace, check whether any remaining Workspace still references it;
4. only when unreferenced:
   - Sandbox -> `clearSandboxAdapter(adapterRef)`;
   - Browser -> `forgetBrowserWorkspaceGrant(adapterRef)`;
5. if cleanup fails, keep the logical Workspace removed but surface an error toast explaining that cached authorization/storage cleanup was incomplete.

Do not expose this deletion path as an Agent tool.

- [ ] **Step 6: Deduplicate the Add Sandbox control**

Settings must call `ensureDefaultSandboxWorkspace()`.

If a default Sandbox already exists, do not render a second `添加 Sandbox` action. Either omit it or label the action `切换到 Sandbox` and only activate the existing row. Prefer omitting it because each row already has `设为当前`.

Keep `添加本地位置` as the persistent add action.

- [ ] **Step 7: Fix stale V1 copy**

The Computer Agent description currently says:

```text
V1：不包含文件写入工具
```

This became false after Part 2. Replace it with concise accurate copy such as:

```text
开启后 Kiro 可在授权工作区内读取、创建和受控修改文件；危险系统能力仍保持禁用。
```

- [ ] **Step 8: Run the targeted E2E GREEN**

```bash
npx playwright test tests/e2e/kiro-computer-controls.spec.ts
```

- [ ] **Step 9: Run final typecheck**

```bash
npm run typecheck
```

Build remains skipped unless a Next/client boundary issue appears.

- [ ] **Step 10: Commit**

```bash
git add components/settings/KiroAgentSettings.tsx tests/e2e/kiro-computer-controls.spec.ts
git commit -m "fix(kiro): productize workspace management"
```

---

## Final Self-Review Checklist

- [ ] `handleUseSandbox` / Composer toggle cannot create duplicate default Sandboxes.
- [ ] Legacy duplicate `sandbox-default` Workspace metadata is deduplicated on persisted-store migration without deleting shared files.
- [ ] `activeWorkspaceId` is persisted.
- [ ] Removing active Workspace deterministically selects a remaining Workspace.
- [ ] Removing last Workspace disables Computer Agent.
- [ ] Workspace-scoped permission rules are removed with that Workspace.
- [ ] Sandbox deletion clears only its unreferenced adapter namespace.
- [ ] Browser Workspace deletion forgets only the handle record and never deletes user files.
- [ ] Shared adapterRef cleanup is reference-safe.
- [ ] Settings list is compact and no longer shows a large card plus multiple detached badge rows.
- [ ] Every Workspace has a discoverable delete action.
- [ ] Non-current Workspace can be selected explicitly.
- [ ] No new model-facing delete tool exists.
- [ ] Part 3 approval/task/history/checkpoint behavior is untouched.
- [ ] Focused unit tests PASS.
- [ ] `kiro-computer-controls.spec.ts` PASS.
- [ ] `npm run typecheck` PASS.
- [ ] `npm run build` skipped by policy unless explicitly justified.
