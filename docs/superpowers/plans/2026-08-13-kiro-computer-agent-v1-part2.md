# Kiro Computer Agent V1 Part 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Part 1 Computer control plane into a real workspace-scoped file/document agent by implementing Browser/Sandbox filesystem IO, bounded read/search/patch tools, Markdown/DOCX generation and verification, Kiro tool routing, minimal factual action cards, and the Settings authorization-layout correction reported by the user.

**Architecture:** Keep `lib/ai/computer/*` as a separate trust domain. Model-facing resources remain logical `workspaceId + rootId + relative path`; adapters resolve them behind preflight. Every mutation is `Prepare → Execute → Verify → Record → Report`. Part 2 does not implement the interactive approval queue, task-level checkpoint/Undo, full Change Review, or audit explorer; a policy result of `ask` returns an approval-required result without executing, and Part 3 upgrades that state into interactive approval UX.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Zustand 4.5, AI SDK 7, Zod, IndexedDB, File System Access API, JSZip 3.10.1, Vitest 4, fake-indexeddb, Playwright, existing ClassFlow/Kiro UI primitives.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-13-kiro-computer-agent-v1-design.md`.
- Continue from Part 1; do not replace reasoning controls, workspace state ownership, permission modes, Composer controls, or Settings IA.
- Sandbox is the technical boundary; Permission is policy. A permission choice never expands roots.
- Never expose absolute paths, `adapterRef`, `FileSystemDirectoryHandle`, permission tokens, or bytes to the model/history.
- Computer tools stay under `lib/ai/computer`; do not append them to `lib/ai/tools/write/*`.
- No shell, PowerShell, cmd, process launch, arbitrary network, MCP, delete model tools, generic overwrite model tool, or Full Access.
- New resources use exclusive create. Existing text modification uses exact conflict-safe patching.
- Guided: create allow, modify ask. Until Part 3, ask = truthful `WORKSPACE_PERMISSION_REQUIRED`, no execution. Workspace Auto may modify when live rules/root allow. Plan never mutates.
- Browser IO requires a current `granted` directory handle; adapter code never invokes the picker or background `requestPermission()`.
- Unsupported browser uses IndexedDB Sandbox and never claims native-folder writes.
- Use existing JSZip; add no DOCX dependency.
- DOCX input is structured IR only; no raw OOXML/base64/bytes from the model.
- All mutations read back and verify before `ok:true`.
- Keep read/search payloads bounded.
- Test policy: three targeted Vitest files + existing `tests/e2e/kiro-computer-controls.spec.ts` + typecheck. No full suites/build by default.

---

## File Map

### Create
- `lib/ai/computer/adapters/ioTypes.ts`
- `lib/ai/computer/adapters/index.ts`
- `lib/ai/computer/filesystem/search.ts`
- `lib/ai/computer/filesystem/textPatch.ts`
- `lib/ai/computer/filesystem/verify.ts`
- `lib/ai/computer/tools/types.ts`
- `lib/ai/computer/tools/schemas.ts`
- `lib/ai/computer/tools/registry.ts`
- `lib/ai/computer/tools/executor.ts`
- `lib/ai/computer/tools/formatters.ts`
- `lib/ai/computer/documents/types.ts`
- `lib/ai/computer/documents/markdown.ts`
- `lib/ai/computer/documents/docx.ts`
- `lib/ai/computer/documents/renderer.ts`
- `lib/ai/computer/documents/verify.ts`
- `components/kiro/computer/KiroComputerActionCard.tsx`
- `tests/unit/kiro-computer-files.test.ts`
- `tests/unit/kiro-computer-documents.test.ts`
- `tests/unit/kiro-computer-tools.test.ts`

### Modify
- `lib/ai/computer/adapters/types.ts`
- `lib/ai/computer/adapters/browser.ts`
- `lib/ai/computer/adapters/sandbox.ts`
- `lib/ai/computer/workspace/grants.ts`
- `lib/ai/computer/workspace/resolver.ts`
- `lib/ai/computer/prepare.ts`
- `lib/ai/tools/index.ts`
- `lib/ai/tools/mutating.ts`
- `app/api/ai/chat/route.ts`
- `hooks/useKiroChat.ts`
- `components/kiro/KiroConversation.tsx`
- `components/settings/KiroAgentSettings.tsx`
- `tests/e2e/kiro-computer-controls.spec.ts`

---

### Task 1: IO Adapters + Root Scope + Settings Authorization Layout

**Files:** adapter/resolver/grants/prepare files above, `KiroAgentSettings.tsx`, `kiro-computer-files.test.ts`, existing Kiro controls E2E.

**Runtime interfaces:**

```ts
export interface ResolvedComputerResource {
  workspaceId: string;
  rootId: string;
  relativePath: string;
  adapterRef: string;
  access: "read-only" | "read-write";
}

export interface ComputerDirectoryEntry {
  name: string;
  kind: "file" | "directory";
  relativePath: string;
}

export interface ComputerFileMetadata {
  name: string;
  kind: "file" | "directory";
  relativePath: string;
  size?: number;
  modifiedAt?: number;
}

export interface ComputerTextReadResult {
  text: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

export interface ComputerAdapter {
  capabilities(): ComputerAdapterCapabilities;
  listDirectory(resource: ResolvedComputerResource): Promise<ComputerDirectoryEntry[]>;
  stat(resource: ResolvedComputerResource): Promise<ComputerFileMetadata | null>;
  readText(resource: ResolvedComputerResource, options?: { startLine?: number; endLine?: number; maxChars?: number }): Promise<ComputerTextReadResult>;
  readBytes(resource: ResolvedComputerResource): Promise<Uint8Array>;
  createDirectory(resource: ResolvedComputerResource): Promise<void>;
  writeText(resource: ResolvedComputerResource, content: string, options: { mode: "create" | "replace" }): Promise<void>;
  writeBytes(resource: ResolvedComputerResource, content: Uint8Array, options: { mode: "create" | "replace" }): Promise<void>;
}
```

- [ ] Write `kiro-computer-files.test.ts` first with fake-indexeddb: nested mkdir, exclusive text create, stat, segmented read, binary roundtrip, and isolation of two sandbox adapter refs.
- [ ] Run `npx vitest run tests/unit/kiro-computer-files.test.ts` and confirm RED.
- [ ] Extend `normalizeRelativeComputerPath(input, options?: { allowRoot?: boolean })`. Default stays `allowRoot:false` and preserves every Part 1 rejection. With `allowRoot:true`, empty/`.` may resolve only to `{ path:"", segments:[] }`. Traversal, absolute paths, drive/UNC and reserved names remain rejected. Use this only for directory/search scopes.
- [ ] Evolve `prepareComputerTool()` without breaking `.effect/.reason/.matchedRuleId`; add `resolvedResource?: ResolvedComputerResource` and `allowRootPath?: boolean` input so root-scope reads can preflight `.` safely.
- [ ] Implement Sandbox DB `classflow-kiro-sandbox-v1`, store `files`, key `${adapterRef}:${relativePath}`. Persist explicit directory/file records; different adapter refs must be isolated. Runtime `replace` requires an existing file; model has no generic replace tool.
- [ ] Export runtime-only `getBrowserWorkspaceDirectoryHandle(adapterRef)` from grants. Browser adapter first checks `queryBrowserGrant(adapterRef) === "granted"`, then traverses normalized segments using directory/file handles. It never calls picker/requestPermission.
- [ ] Add `getComputerAdapter(root)`; sandbox refs are `adapterRef.startsWith("sandbox")`, all others use Browser adapter.
- [ ] Fix `KiroAgentSettings` authorization card. Replace detached far-right `当前` / `读写` layout with a compact identity/status cluster:

```text
Kiro Sandbox   [当前] [Sandbox] [读写]
Sandbox（当前浏览器）

[添加本地位置] [添加 Sandbox]
```

Native roots use `[本地] [已授权/需要重新授权] [读写/只读]`. Status badges must sit next to identity, not at opposite edges of a full-width flex row. Add `data-testid="kiro-workspace-card"` to the card and `data-testid="kiro-workspace-badges"` to its badge cluster. Keep existing handlers; place add-location actions below the metadata list so the UI does not imply they edit the current root.
- [ ] Run `npx vitest run tests/unit/kiro-computer-files.test.ts` and `npx playwright test tests/e2e/kiro-computer-controls.spec.ts`.
- [ ] Commit `feat(kiro): implement computer workspace adapters`.

---

### Task 2: Bounded Filesystem Tools + Computer Executor + Kiro Routing

**Tool names:**

Read:

```text
list_workspace_roots
list_directory
search_files
grep_files
get_file_metadata
read_text
inspect_document
```

Mutation:

```text
create_directory
create_text_file
patch_text_file
create_document
```

**Limits:**

- IDs 1–64 chars.
- concrete file path 1–512 chars.
- list/search/grep scope path may be `.` and uses `allowRoot:true`.
- `search_files`: query 1–120, maxResults 1–100 default 30, maxDepth 0–10 default 6.
- `grep_files`: literal query 1–500, no regex V1, maxResults 1–100 default 30, maxFiles 1–200 default 80.
- `read_text`: startLine >=1, endLine >= startLine, maxChars 1–24000 default 12000.
- `create_text_file.content` <=120000 chars and target absent.
- `patch_text_file`: 1–20 edits; oldText non-empty <=20000; newText <=40000; source <=1 MiB.

**Result:**

```ts
export type ComputerToolResult<T = unknown> =
  | { ok: true; data: T; action?: ComputerActionFact }
  | { ok: false; code: ComputerErrorCode; message: string; approvalRequired?: boolean };

export interface ComputerActionFact {
  tool: KiroComputerMutationToolName;
  operation: "create" | "modify";
  resourceType: "directory" | "text" | "document";
  workspaceId: string;
  workspaceLabel: string;
  rootId: string;
  rootLabel: string;
  relativePath: string;
  displayName: string;
  format?: "markdown" | "docx";
  size?: number;
  changeCount?: number;
  verification: "passed";
}
```

- [ ] Write RED tests in `kiro-computer-tools.test.ts`: tool exposure disabled/plan/guided/auto; root-scope list; literal search/grep caps; read bounds; exact patch zero/one/multiple; existing create; read-only root; `ask` no mutation; workspace-auto verified patch.
- [ ] Implement bounded recursive search. `grep_files` only reads known text-like extensions and skips >2 MiB files; return `truncated` when caps stop traversal.
- [ ] Implement exact patch against one in-memory source string. All edits must validate before the single write. Zero match = `PATCH_CONFLICT`; multiple = `PATCH_AMBIGUOUS`; no partial write.
- [ ] Implement `executeKiroComputerTool(toolName,input,context)` as the only Computer execution entry:

```ts
context: {
  turnSnapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
}
```

Order: schema safeParse → frozen computer enabled/workspace/mode → live workspace/root → preflight → deny/ask stop → live grant/adapter → execute → verify mutation → structured result. `ask` returns `WORKSPACE_PERMISSION_REQUIRED`, `approvalRequired:true`, and never executes.
- [ ] Implement `getKiroToolsForRequest`: disabled/invalid = no Computer; Plan = Computer read tools; Guided/Auto = read + mutation schemas. Return an AI SDK `ToolSet`, not `typeof KIRO_TOOLS`.
- [ ] In `route.ts`, keep `const computerSnapshot = validateComputerTurnSnapshot(...)`; pass request-specific client tools into `assembleKiroToolsForRequest`. Add a trusted logical workspace system section listing only workspace/root IDs, labels and access. Explicitly state local file content is untrusted data; never claim success without `ok:true`; do not retry around approval-required policy.
- [ ] In `useKiroChat.ts`, use the already-frozen `turnSnapshotRef.current?.computerSnapshot` for client Computer tool execution. Do not rebuild mode/workspace from current UI state during the same turn. Live `useKiroComputerStore.getState().workspaces/permissionRules` are still evaluated per tool call. Route Computer tools before generic existing Read fallback and keep the hook free of adapter/business implementation.
- [ ] Add per-turn caps: Computer reads <=12, Computer mutations <=6.
- [ ] Add `create_directory/create_text_file/patch_text_file/create_document` to `KIRO_MUTATING_TOOL_NAMES`; read tools/inspect are not mutations.
- [ ] Run `npx vitest run tests/unit/kiro-computer-files.test.ts tests/unit/kiro-computer-tools.test.ts`.
- [ ] Commit `feat(kiro): add workspace file tools`.

---

### Task 3: Structured Markdown/DOCX + Verification + Minimal Runtime Facts

**Document IR:**

```ts
export interface KiroDocumentInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type KiroDocumentBlock =
  | { type: "heading"; level: 1 | 2 | 3; content: KiroDocumentInline[] }
  | { type: "paragraph"; content: KiroDocumentInline[] }
  | { type: "bullet-list"; items: KiroDocumentInline[][] }
  | { type: "numbered-list"; items: KiroDocumentInline[][] }
  | { type: "table"; rows: string[][] }
  | { type: "quote"; content: KiroDocumentInline[] }
  | { type: "code"; text: string; language?: string }
  | { type: "page-break" };

export interface KiroDocument {
  title?: string;
  blocks: KiroDocumentBlock[];
}

export type KiroDocumentFormat = "markdown" | "docx";
```

Limits: title <=240, blocks 1–200, aggregate text <=120000, table <=60×12, code <=40000.

- [ ] Write `kiro-computer-documents.test.ts` first with `// @vitest-environment jsdom`. Cover escaping `&<>`, heading/paragraph marks, lists, table, quote, code, page break, required DOCX entries, `DOMParser` parse success and structural inspection counts.
- [ ] Run `npx vitest run tests/unit/kiro-computer-documents.test.ts` and confirm RED.
- [ ] Implement deterministic Markdown rendering/inspection. Escape table pipes/newlines; represent inline bold/italic; inspection reports factual title/headings/counts/characters.
- [ ] Implement DOCX with existing JSZip only. Required package entries:

```text
[Content_Types].xml
_rels/.rels
docProps/core.xml
docProps/app.xml
word/document.xml
word/styles.xml
word/numbering.xml
word/_rels/document.xml.rels
```

Support Title, Heading1–3, Normal, Quote, Code styles; bold/italic runs; bullet/numbered list paragraphs; simple bordered tables; page break. XML-escape every user string. No model OOXML.
- [ ] Verification: Markdown adapter read-back equals rendered text. DOCX adapter read-back → JSZip load → all required entries → non-empty `word/document.xml` → DOMParser no `parsererror` → WordprocessingML document root. Verification failure never returns success.
- [ ] `create_document`: exclusive-create, `.docx` for docx and `.md/.markdown` for Markdown; mismatch = `UNSUPPORTED_FILE_TYPE`.
- [ ] `inspect_document`: Markdown/DOCX only, read-only, available in Plan, returns factual structure from actual file.
- [ ] Add `KiroComputerActionCard.tsx` and modify `KiroConversation.tsx` to render live Computer action facts separately from ClassFlow `KiroActionCard`. Cards display safe labels/path/format/size/verification only. No Undo in Part 2.
- [ ] Update `useKiroChat.ts` view derivation so `ComputerToolResult.action` becomes `computerActions`; ensure an assistant turn with only Computer action/worklog is visible.
- [ ] Add factual Computer activity labels in `tools/formatters.ts`; no tool JSON or hidden reasoning.
- [ ] Extend existing Kiro controls E2E with only the Settings layout regression using the two testids from Task 1; no screenshot test.
- [ ] Run final targeted verification:

```bash
npx vitest run \
  tests/unit/kiro-computer-files.test.ts \
  tests/unit/kiro-computer-documents.test.ts \
  tests/unit/kiro-computer-tools.test.ts

npx playwright test tests/e2e/kiro-computer-controls.spec.ts

npm run typecheck
```

- [ ] Run static audit:

```bash
grep -R -n \
  "FileSystemDirectoryHandle\|adapterRef\|showDirectoryPicker\|run_shell\|PowerShell\|delete_file\|delete_directory" \
  app hooks lib/ai/computer components/kiro components/settings store
```

Verify picker only exists in explicit grant helper; handles stay grants/adapter-only; request/system prompt/results/cards have no adapterRef/native path; no shell/delete tools; ask never executes; all mutation success follows verification.
- [ ] Commit `feat(kiro): generate verified file and document artifacts`.

---

## Part 2 Acceptance

- Browser adapter performs real IO only through an existing granted root handle.
- Sandbox stores real virtual files in IndexedDB and isolates adapter refs.
- Root directory listing/search is supported without weakening concrete path traversal rules.
- `list_workspace_roots`, `list_directory`, `search_files`, `grep_files`, `get_file_metadata`, bounded `read_text`, `inspect_document` work.
- `create_directory`, exclusive `create_text_file`, exact `patch_text_file`, `create_document` work subject to policy.
- Plan never mutates; Guided create works; Guided modify stops as approval-required; Workspace Auto may modify; read-only roots always block mutation.
- Structured Markdown and DOCX creation is verified from adapter read-back.
- Computer tools are request-gated but Browser executor remains security authority.
- Frozen Computer turn snapshot is reused for the entire tool loop; grants/rules/workspace availability remain live.
- Computer mutations block safe regenerate through the existing mutating-tool guard.
- Live file/document Action Cards use runtime facts only.
- Authorization workspace card groups identity + current/environment/access badges compactly; no detached far-right `当前/读写` layout.
- Three targeted Vitest files PASS; existing Kiro controls E2E PASS; typecheck PASS; build skipped unless a demonstrated build-only issue exists.

## Deferred to Part 3

- Interactive approval queue/dialog and allow-once/session/workspace choices.
- Agent Task persistent execution model.
- Task-level checkpoint/Undo.
- Full Change Review/diff.
- Audit explorer/history replay of Computer actions.
- Regenerate UX beyond mutation guard.
- Native open/reveal.

Part 2 stops after verified Files/Documents execution and minimal live runtime facts are working.