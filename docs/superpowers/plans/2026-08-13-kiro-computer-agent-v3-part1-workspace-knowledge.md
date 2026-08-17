# Kiro Computer Agent V3 Part 1 — Workspace Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded local Workspace Knowledge index plus live root-level `KIRO.md` instructions so Kiro can find relevant authorized files efficiently while keeping the filesystem, current permissions, and live reads authoritative.

**Architecture:** Add a browser-local Knowledge service behind the existing Computer Runtime. The service stores bounded lexical file/chunk metadata in IndexedDB, refreshes on demand, and is marked dirty after verified Kiro filesystem mutations. `KIRO.md` is not indexed: after the Computer Turn Snapshot is frozen, the client runtime reads the exact root-level file through the existing authorized adapter and current `fs.read` policy, sends only a bounded typed instruction context, and the server revalidates it against the frozen logical snapshot before adding the Workspace Instructions section.

**Tech Stack:** TypeScript 5.5, Next.js 14, React 18, AI SDK 7, Zustand 4, IndexedDB / fake-indexeddb, Mammoth 1.12, Vitest 4, Playwright 1.62.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-13-kiro-computer-agent-v3-workspace-knowledge-design.md` plus the higher-priority clarification `docs/superpowers/specs/2026-08-13-kiro-v3-knowledge-implementation-clarification.md`.
- Baseline HEAD before implementation should contain `f3e34e46ac39a58028737d645b00b87099306b7c`, `3687b53785d6c970bd298b53f6d1dfe3797a38f1`, and V2 closeout `9d9f89b73f49bdf15ccdc7e77f289c25de5eab55`.
- Do not reset/revert unrelated work. Inspect `git status` and recent commits before touching files.
- Preserve the existing security chain: frozen turn intent + live Workspace/rules/grants + path sandbox + policy + adapter + verification.
- Browser `FileSystemDirectoryHandle` remains client-only. `/api/ai/chat` MUST NOT directly read Browser Workspace files.
- Never persist or expose native paths, adapter refs, handles, grant tokens, file bytes, whole prompts, chat history, or Artifact Source IR in the Knowledge DB or model-facing output.
- Knowledge is a candidate cache, never filesystem truth. Current content claims still require a live `read_text` / `inspect_document` call.
- Exact root-level `KIRO.md` only. No nested inheritance in V3 Part 1.
- Instruction precedence remains: system/developer policy > explicit current user request > KIRO.md Workspace Instructions > ordinary workspace data.
- `KIRO.md` cannot expand Roots, capabilities, permissions, Agent Mode, or bypass approval.
- No embeddings, vector DB, cloud indexing, watcher/polling, PDF OCR/content indexing, shell, MCP, Tauri/Windows runtime, full Explorer, or KIRO.md editor.
- Fixed Knowledge limits: 2,000 discovered files/workspace refresh; traversal depth 12; body indexing only <= 2 MiB; 20 chunks/file; target ~1,800 characters/chunk; 10,000 chunks/workspace; search default 20, hard cap 50.
- Fixed KIRO.md limits: 8,000 characters/root; 16,000 characters/workspace turn. Read only a bounded prefix from native files; never load an arbitrarily large KIRO.md merely to slice it afterward.
- `search_workspace_knowledge` consumes exactly one Computer read/search call. Internal refresh work does not increment model tool counters per scanned file.
- Settings `更新索引` is a bounded force refresh and is the repair path for external same-size edits that cheap metadata fingerprints can miss.
- Large files: use `rg`/`grep` and bounded `sed`/file ranges; do not repeatedly load entire large files.
- Tests: run targeted Vitest/E2E plus `npm run typecheck`. Skip full suite/build unless a client/server import boundary or bundling issue makes build necessary.

---

## File Map

### New runtime files

- `lib/ai/computer/knowledge/types.ts` — persisted/model-safe Knowledge types, constants, stable file/chunk keys.
- `lib/ai/computer/knowledge/db.ts` — `classflow-kiro-knowledge-v1` IndexedDB access; workspace/file/chunk transactions and cleanup.
- `lib/ai/computer/knowledge/tokenize.ts` — deterministic Unicode/Latin/CJK normalization and token counts.
- `lib/ai/computer/knowledge/rank.ts` — deterministic lexical ranking and bounded snippets.
- `lib/ai/computer/knowledge/extract.ts` — text/DOCX extraction and chunk creation; metadata-only fallback.
- `lib/ai/computer/knowledge/scanner.ts` — bounded deterministic Workspace traversal; excludes `KIRO.md`.
- `lib/ai/computer/knowledge/service.ts` — refresh/status/dirty/clear/search orchestration.
- `lib/ai/computer/knowledge/instructions.ts` — client-side KIRO.md loader with injected adapter resolver + pure server-side revalidation/render helpers.
- `components/settings/KiroWorkspaceKnowledgePanel.tsx` — compact current-Workspace index status/actions.

### Existing files to modify

- `lib/ai/computer/executor-types.ts` — add bounded text-prefix adapter primitive.
- `lib/ai/computer/adapters/browser.ts` — browser `File.slice()` bounded text-prefix read.
- `lib/ai/computer/adapters/sandbox.ts` — bounded text-prefix read from Sandbox records.
- `lib/ai/computer/executor.ts` — adapter mapping, mutation dirty marking, Knowledge search tool execution.
- `lib/ai/computer/tools/schemas.ts` — `searchWorkspaceKnowledgeSchema`.
- `lib/ai/computer/tools/registry.ts` — register read-only `search_workspace_knowledge`.
- `lib/ai/tools/formatters.ts` — Activity label for Knowledge search.
- `hooks/useKiroChat.ts` — freeze Computer snapshot first; then asynchronously load live bounded KIRO.md context; mark Knowledge dirty after Undo attempts that may change files.
- `app/api/ai/chat/route.ts` — normalize typed KIRO.md context against frozen logical roots and append bounded Workspace Instructions section.
- `components/settings/KiroAgentSettings.tsx` — mount Knowledge panel and clear Knowledge records during Workspace removal.
- `tests/unit/kiro-computer-tools.test.ts` — tool exposure/count/root/policy/read-quota regressions.

### New tests

- `tests/unit/kiro-knowledge-runtime.test.ts`
- `tests/unit/kiro-knowledge-ranking.test.ts`
- `tests/unit/kiro-workspace-instructions.test.ts`
- `tests/e2e/kiro-computer-knowledge-v3.spec.ts`

---

### Task 1: Knowledge Runtime + Live KIRO.md Instruction Pipeline

**Files:**
- Create: `lib/ai/computer/knowledge/types.ts`
- Create: `lib/ai/computer/knowledge/db.ts`
- Create: `lib/ai/computer/knowledge/tokenize.ts`
- Create: `lib/ai/computer/knowledge/rank.ts`
- Create: `lib/ai/computer/knowledge/extract.ts`
- Create: `lib/ai/computer/knowledge/scanner.ts`
- Create: `lib/ai/computer/knowledge/service.ts`
- Create: `lib/ai/computer/knowledge/instructions.ts`
- Modify: `lib/ai/computer/executor-types.ts`
- Modify: `lib/ai/computer/adapters/browser.ts`
- Modify: `lib/ai/computer/adapters/sandbox.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `hooks/useKiroChat.ts`
- Modify: `app/api/ai/chat/route.ts`
- Test: `tests/unit/kiro-knowledge-runtime.test.ts`
- Test: `tests/unit/kiro-knowledge-ranking.test.ts`
- Test: `tests/unit/kiro-workspace-instructions.test.ts`

**Interfaces:**

```ts
export type KiroKnowledgeContentType = "text" | "docx" | "metadata";
export type KiroKnowledgeContentStatus = "indexed" | "metadata-only" | "failed";

export interface KiroKnowledgeWorkspaceState {
  workspaceId: string;
  lastIndexedAt: string;
  fileCount: number;
  chunkCount: number;
  partial: boolean;
  dirty: boolean;
  unavailableRootIds: string[];
}

export interface KiroKnowledgeFileRecord {
  key: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  extension: string;
  type: KiroKnowledgeContentType;
  size: number;
  title?: string;
  fingerprint: string;
  contentStatus: KiroKnowledgeContentStatus;
  indexedAt: string;
}

export interface KiroKnowledgeChunkRecord {
  key: string;
  fileKey: string;
  workspaceId: string;
  rootId: string;
  relativePath: string;
  ordinal: number;
  text: string;
  tokenCounts: Record<string, number>;
}

export interface KiroKnowledgeSearchResult {
  rootId: string;
  path: string;
  title?: string;
  type: KiroKnowledgeContentType;
  snippet?: string;
  score: number;
  matchReasons: Array<"filename" | "path" | "title" | "phrase" | "content-token">;
}

export type KiroKnowledgeIndexState = "ready" | "partial" | "stale" | "unavailable";
```

Constants belong in `types.ts` and are imported everywhere rather than duplicated:

```ts
export const KIRO_KNOWLEDGE_DB = "classflow-kiro-knowledge-v1";
export const KIRO_KNOWLEDGE_MAX_FILES = 2_000;
export const KIRO_KNOWLEDGE_MAX_DEPTH = 12;
export const KIRO_KNOWLEDGE_MAX_CONTENT_BYTES = 2 * 1024 * 1024;
export const KIRO_KNOWLEDGE_MAX_CHUNKS_PER_FILE = 20;
export const KIRO_KNOWLEDGE_TARGET_CHARS_PER_CHUNK = 1_800;
export const KIRO_KNOWLEDGE_MAX_CHUNKS_PER_WORKSPACE = 10_000;
export const KIRO_KNOWLEDGE_SEARCH_DEFAULT_RESULTS = 20;
export const KIRO_KNOWLEDGE_SEARCH_MAX_RESULTS = 50;
export const KIRO_KNOWLEDGE_SNIPPET_MAX_CHARS = 320;
export const KIRO_INSTRUCTIONS_MAX_CHARS_PER_ROOT = 8_000;
export const KIRO_INSTRUCTIONS_MAX_CHARS_TOTAL = 16_000;
export const KIRO_INSTRUCTIONS_PREFIX_MAX_BYTES = 64 * 1024;
```

Adapter contract:

```ts
interface ComputerAdapterIO {
  // existing methods unchanged
  readTextPrefix(path: string, maxBytes: number): Promise<{ text: string; truncated: boolean }>;
}
```

Browser implementation MUST use the underlying `File.slice(0, maxBytes).text()` and `file.size > maxBytes` for truncation. Sandbox implementation MUST slice encoded bytes before decoding; do not return the full string and then slice in the caller.

Knowledge DB API:

```ts
export function getKnowledgeWorkspaceState(workspaceId: string): Promise<KiroKnowledgeWorkspaceState | null>;
export function putKnowledgeWorkspaceState(state: KiroKnowledgeWorkspaceState): Promise<void>;
export function listKnowledgeFiles(workspaceId: string): Promise<KiroKnowledgeFileRecord[]>;
export function listKnowledgeChunks(workspaceId: string): Promise<KiroKnowledgeChunkRecord[]>;
export function replaceKnowledgeFile(
  file: KiroKnowledgeFileRecord,
  chunks: KiroKnowledgeChunkRecord[]
): Promise<void>;
export function removeKnowledgeFile(fileKey: string): Promise<void>;
export function clearWorkspaceKnowledge(workspaceId: string): Promise<void>;
```

`replaceKnowledgeFile` must run file-record replacement plus deletion/replacement of that file's chunks in one readwrite transaction. `clearWorkspaceKnowledge` removes only Knowledge DB records for the logical Workspace.

Service API:

```ts
export async function refreshWorkspaceKnowledge(input: {
  workspace: KiroWorkspaceMeta;
  mode: "incremental" | "force";
  agentMode: KiroAgentMode;
  permissionRules: ComputerPermissionRule[];
  getAdapter: (adapterRef: string) => ComputerAdapterIO;
}): Promise<KiroKnowledgeWorkspaceState>;

export async function getWorkspaceKnowledgeStatus(
  workspaceId: string
): Promise<KiroKnowledgeWorkspaceState | null>;

export async function markWorkspaceKnowledgeDirty(workspaceId: string): Promise<void>;

export async function queryWorkspaceKnowledge(input: {
  workspaceId: string;
  query: string;
  rootIds?: string[];
  maxResults?: number;
}): Promise<Array<KiroKnowledgeSearchResult & { metadataScore: number; contentScore: number }>>;
```

Instruction context:

```ts
export type KiroWorkspaceInstructionAvailability = "loaded" | "missing" | "unavailable";

export interface KiroWorkspaceInstructionEntry {
  workspaceId: string;
  rootId: string;
  rootLabel: string;
  path: "KIRO.md";
  availability: KiroWorkspaceInstructionAvailability;
  text?: string;
  truncated: boolean;
}

export interface KiroWorkspaceInstructionsContext {
  workspaceId: string;
  entries: KiroWorkspaceInstructionEntry[];
}

export async function loadWorkspaceInstructionsForTurn(input: {
  snapshot: KiroComputerTurnSnapshot;
  liveWorkspaces: KiroWorkspaceMeta[];
  livePermissionRules: ComputerPermissionRule[];
  getAdapter: (adapterRef: string) => ComputerAdapterIO;
}): Promise<KiroWorkspaceInstructionsContext | undefined>;

export function normalizeWorkspaceInstructionsForPrompt(
  value: unknown,
  snapshot: KiroComputerTurnSnapshot | null
): KiroWorkspaceInstructionEntry[];

export function buildWorkspaceInstructionsSection(
  entries: KiroWorkspaceInstructionEntry[]
): string;
```

- [ ] **Step 1: Write failing Knowledge DB/runtime tests.**

In `tests/unit/kiro-knowledge-runtime.test.ts`, cover actual persisted behavior with `fake-indexeddb/auto`:

```ts
it("replaceKnowledgeFile atomically replaces prior chunks", async () => {
  await replaceKnowledgeFile(file("notes.md"), [chunk("notes.md", 0, "alpha")]);
  await replaceKnowledgeFile(file("notes.md"), [chunk("notes.md", 0, "beta")]);
  expect((await listKnowledgeChunks("ws-1")).map((c) => c.text)).toEqual(["beta"]);
});

it("clearWorkspaceKnowledge never touches another workspace", async () => {
  await seedWorkspace("ws-a", "a.md");
  await seedWorkspace("ws-b", "b.md");
  await clearWorkspaceKnowledge("ws-a");
  expect(await listKnowledgeFiles("ws-a")).toEqual([]);
  expect((await listKnowledgeFiles("ws-b")).map((f) => f.relativePath)).toEqual(["b.md"]);
});
```

Also cover: stale file removal after refresh; unsupported/PDF metadata-only; >2 MiB metadata-only; extraction failure only marks one file failed; dirty flag; force refresh re-extracts a same-size changed file; `KIRO.md` absent from files/chunks; deterministic root/path traversal; depth/file/chunk limits set `partial=true`.

- [ ] **Step 2: Run the runtime tests and verify they fail because the Knowledge modules do not exist.**

Run:

```bash
npx vitest run tests/unit/kiro-knowledge-runtime.test.ts
```

Expected: FAIL on missing `@/lib/ai/computer/knowledge/...` imports.

- [ ] **Step 3: Implement `types.ts` and `db.ts` with stable logical keys and IndexedDB indexes.**

Use deterministic keys only:

```ts
export function knowledgeFileKey(workspaceId: string, rootId: string, relativePath: string): string {
  return `${workspaceId}\u0000${rootId}\u0000${relativePath}`;
}

export function knowledgeChunkKey(fileKey: string, ordinal: number): string {
  return `${fileKey}\u0000${String(ordinal).padStart(4, "0")}`;
}
```

DB stores:

```text
workspaces  keyPath=workspaceId
files       keyPath=key, indexes: by-workspace
chunks      keyPath=key, indexes: by-workspace, by-file
```

Never store adapterRef/native path/handle/bytes.

- [ ] **Step 4: Write failing tokenizer/ranker tests before implementing ranking.**

In `tests/unit/kiro-knowledge-ranking.test.ts`:

```ts
it("normalizes Latin case and produces word tokens", () => {
  expect(tokenizeKnowledgeText("Policy Adoption 2026")).toEqual(
    expect.arrayContaining(["policy", "adoption", "2026"])
  );
});

it("produces overlapping CJK 2-grams and 3-grams", () => {
  const tokens = tokenizeKnowledgeText("研究方法");
  expect(tokens).toEqual(expect.arrayContaining(["研究", "究方", "方法", "研究方", "究方法"]));
});

it("filename exact match outranks body-only match deterministically", () => {
  const ranked = rankKnowledgeCandidates("研究方法", fixtures);
  expect(ranked[0].path).toBe("research/研究方法.md");
});
```

- [ ] **Step 5: Implement `tokenize.ts` and `rank.ts`.**

Normalization: Unicode NFKC, lowercase Latin, collapse whitespace/punctuation boundaries. Generate Latin/number word tokens; for contiguous CJK sequences generate overlapping 2-grams and 3-grams, with a one-character fallback only when the whole CJK sequence is one character.

Ranking must produce separate `metadataScore` and `contentScore` so Task 2 can safely strip body-derived evidence when current `fs.read` is not allowed. Use fixed constants, not recency:

```ts
const SCORE = {
  exactFilename: 100,
  filenameToken: 20,
  pathToken: 10,
  titleToken: 15,
  phrase: 50,
  contentToken: 6,
  termFrequency: 2,
} as const;
```

Cap every additive component; one repeated token must not dominate ranking. Snippets are at most 320 characters and center around the first phrase/token match when possible.

- [ ] **Step 6: Implement extraction and bounded scanner.**

`extract.ts` must reuse `TEXT_LIKE_EXTENSIONS` from `lib/ai/computer/filesystem/search.ts`. DOCX extraction reuses the existing `extractDocx` path from `@/lib/ai/attachments/docx`; do not parse/store OOXML or HTML.

Scanner invariants:

```ts
if (relativePath === "KIRO.md") skip ordinary Knowledge record/chunks;
if (depth > 12) { partial = true; skip subtree; }
if (discoveredFiles >= 2_000) { partial = true; stop discovering new files; }
if (file.size > 2 * 1024 * 1024) metadataOnly();
if (workspaceChunks >= 10_000) metadataOnlyAndPartial();
```

Sort each adapter `list()` result deterministically before traversal even if the adapter already sorts.

For content extraction, evaluate current exact-file `fs.read` policy before reading. `allow` may index content; `ask` or `deny` produces metadata-only records and MUST NOT auto-open approval.

Cheap fingerprint:

```ts
fingerprint = `${rootId}\u0000${relativePath}\u0000${size}\u0000${mimeOrExtension}`;
```

Incremental behavior:
- if state is clean and fingerprint matches, reuse existing file/chunks;
- if state is dirty, do not trust same-size fingerprints for content: re-extract eligible supported files within normal bounds;
- force always re-extracts eligible supported files;
- external same-size edits while clean may stay stale until force refresh; this is why Settings `更新索引` is force.

- [ ] **Step 7: Implement `service.ts` orchestration and dirty semantics.**

Refresh scans all Workspace roots in stable Workspace root order. Root access failures are recorded in `unavailableRootIds` and set `partial=true`; they do not silently become an empty clean index. New/changed files replace their records/chunks; previously indexed files not observed under successfully scanned roots are removed. Never delete records merely because a root was inaccessible during this refresh.

`markWorkspaceKnowledgeDirty()` is best effort and only updates an existing state; if no index exists, leave it absent so Settings still says “未建立索引” and the first Knowledge search still performs an initial refresh.

- [ ] **Step 8: Add bounded adapter prefix reads and tests.**

Modify `ComputerAdapterIO` and adapter mapping in `executor.ts`. Implement:

```ts
browserReadTextPrefix(adapterRef, path, maxBytes)
sandboxReadTextPrefix(adapterRef, path, maxBytes)
```

Browser must use `File.slice`; Sandbox must slice encoded bytes. Add tests proving a >64 KiB file returns a bounded prefix with `truncated=true` and does not expose the tail sentinel.

- [ ] **Step 9: Write failing KIRO.md pipeline tests.**

`tests/unit/kiro-workspace-instructions.test.ts` must cover:

```ts
it("loads only exact root-level KIRO.md in frozen root order", async () => { /* two roots */ });
it("never promotes nested project/KIRO.md", async () => { /* only root KIRO.md checked */ });
it("fs.read deny or ask omits instructions without approval", async () => { /* availability unavailable */ });
it("applies 8000/root and 16000/workspace bounds", async () => { /* deterministic truncation */ });
it("server normalizer replaces client labels/order with frozen snapshot facts", () => { /* hostile label/order */ });
it("mismatched workspace/root and arbitrary extra fields are dropped", () => { /* no adapterRef/nativePath */ });
it("missing KIRO.md is normal and produces no Workspace Instructions section", () => { /* empty section */ });
```

- [ ] **Step 10: Implement `instructions.ts`.**

Client loader order is frozen snapshot root order. For each exact `KIRO.md`:
1. find the live Workspace matching `snapshot.workspaceId` and live root matching frozen root id;
2. evaluate exact-path `fs.read` with `prepareComputerTool`;
3. if effect is `ask`/`deny`, record `unavailable` and do no file IO;
4. `stat("KIRO.md")`; missing => `missing`;
5. `readTextPrefix("KIRO.md", 64 KiB)`; then apply 8,000-character root limit;
6. apply the 16,000-character total limit in root order.

No approval UI is created by this automatic loader.

Server normalizer takes only `(rawContext, frozenSnapshot)`. It must:
- require matching `workspaceId`;
- accept only root ids present in `snapshot.roots`;
- require literal path `KIRO.md`;
- ignore client-supplied labels and restore root labels/order from snapshot;
- accept only `availability === "loaded"` for prompt content;
- reapply 8,000/root + 16,000 total limits;
- ignore adapterRef/native path/handles/extra fields.

`buildWorkspaceInstructionsSection()` returns `""` when no loaded content. Otherwise prepend a fixed notice that Workspace Instructions guide work but grant no permission and are lower priority than the explicit current user request.

- [ ] **Step 11: Freeze the Computer snapshot before live KIRO.md loading in `useKiroChat`.**

Current send flow sets `turnSnapshotRef.current = buildSnapshotRef.current(turnAttachments)`. Change it to:

```ts
const baseTurnSnapshot = buildSnapshotRef.current(turnAttachments);
const frozenComputerSnapshot = baseTurnSnapshot.computerSnapshot as KiroComputerTurnSnapshot;
const computerWorkspaceInstructions = frozenComputerSnapshot.enabled
  ? await loadWorkspaceInstructionsForTurn({
      snapshot: frozenComputerSnapshot,
      liveWorkspaces: useKiroComputerStore.getState().workspaces,
      livePermissionRules: useKiroComputerStore.getState().permissionRules,
      getAdapter: getComputerAdapterForAdapterRef,
    })
  : undefined;
turnSnapshotRef.current = {
  ...baseTurnSnapshot,
  ...(computerWorkspaceInstructions ? { computerWorkspaceInstructions } : {}),
};
```

Do not rebuild/switch Workspace after loading. Tool continuation requests keep using `requestBody()` and therefore the same frozen instruction context. Regenerate is not a new user turn and continues to reuse the frozen prior snapshot.

- [ ] **Step 12: Add server revalidation and prompt construction.**

In `app/api/ai/chat/route.ts`:

```ts
const workspaceInstructionEntries = normalizeWorkspaceInstructionsForPrompt(
  b.computerWorkspaceInstructions,
  computerSnapshot
);
const workspaceInstructionsSection = buildWorkspaceInstructionsSection(workspaceInstructionEntries);
```

Append the section near the existing Computer Workspace context. Do not read `b.workspaceInstructions`; do not import Browser grants/adapters into the route. Ordinary attachment/Artifact/workspace content stays data, never instructions.

- [ ] **Step 13: Mark Knowledge dirty after every verified Kiro mutation and after Undo attempts that may have changed files.**

In `executor.ts`, add a narrow helper:

```ts
async function markKnowledgeDirtyBestEffort(workspaceId: string): Promise<void> {
  try {
    await markWorkspaceKnowledgeDirty(workspaceId);
  } catch {
    // Knowledge cache failure cannot retroactively fail verified filesystem work.
  }
}
```

Call it only after successful verified create/patch/create_document/update_document/rename/move paths, before returning `ok:true`. A Knowledge failure never changes the already verified tool result.

For Task Undo in `useKiroChat`, collect the checkpoint Workspace ids and call `markWorkspaceKnowledgeDirty()` in a best-effort `finally` path once an inverse attempt has begun. This includes `undo_failed`, because a failed multi-step Undo can still have changed filesystem state.

- [ ] **Step 14: Run Task 1 targeted tests and typecheck.**

Run:

```bash
npx vitest run \
  tests/unit/kiro-knowledge-runtime.test.ts \
  tests/unit/kiro-knowledge-ranking.test.ts \
  tests/unit/kiro-workspace-instructions.test.ts
npm run typecheck
```

Expected: PASS. If typecheck exposes a client/server import boundary, fix that boundary before moving on; do not defer it to Task 3.

- [ ] **Step 15: Commit Task 1.**

```bash
git add \
  lib/ai/computer/knowledge \
  lib/ai/computer/executor-types.ts \
  lib/ai/computer/adapters/browser.ts \
  lib/ai/computer/adapters/sandbox.ts \
  lib/ai/computer/executor.ts \
  hooks/useKiroChat.ts \
  app/api/ai/chat/route.ts \
  tests/unit/kiro-knowledge-runtime.test.ts \
  tests/unit/kiro-knowledge-ranking.test.ts \
  tests/unit/kiro-workspace-instructions.test.ts
git commit -m "feat(kiro): add workspace knowledge runtime"
```

---

### Task 2: `search_workspace_knowledge` Tool + Current-Access Filtering

**Files:**
- Modify: `lib/ai/computer/tools/schemas.ts`
- Modify: `lib/ai/computer/tools/registry.ts`
- Modify: `lib/ai/computer/executor.ts`
- Modify: `lib/ai/tools/formatters.ts`
- Modify: `tests/unit/kiro-computer-tools.test.ts`
- Reuse: `lib/ai/computer/knowledge/service.ts`
- Reuse: `lib/ai/computer/knowledge/rank.ts`

**Interfaces:**

```ts
export const searchWorkspaceKnowledgeSchema = z.object({
  query: z.string().trim().min(1).max(200),
  rootIds: z.array(z.string().trim().min(1).max(120)).min(1).max(32).optional(),
  maxResults: z.number().int().min(1).max(50).optional(),
});
```

Tool definition:

```ts
{
  name: "search_workspace_knowledge",
  description: "在当前 Workspace 的本地知识索引中搜索相关文件候选；正文结论仍需实时读取文件确认。",
  schema: searchWorkspaceKnowledgeSchema,
  capability: "fs.search",
  mutation: false,
}
```

Tool output shape:

```ts
{
  results: Array<{
    rootId: string;
    path: string;
    title?: string;
    type: "text" | "docx" | "metadata";
    snippet?: string;
    score: number;
    matchReasons: string[];
  }>;
  indexState: "ready" | "partial" | "stale" | "unavailable";
  partial: boolean;
}
```

- [ ] **Step 1: Extend failing tool exposure/count tests first.**

Update `tests/unit/kiro-computer-tools.test.ts`:

```ts
it("search_workspace_knowledge is a read tool in all modes", () => {
  for (const mode of ["plan", "guided", "workspace-auto"] as const) {
    const def = getComputerToolsForMode(mode).find((t) => t.name === "search_workspace_knowledge");
    expect(def?.mutation).toBe(false);
    expect(def?.capability).toBe("fs.search");
  }
});
```

Update the exact Computer tool count from 14 to 15 and keep all delete/shell/app/network negative assertions.

Add tests for:
- invalid `rootIds` => `ROOT_NOT_FOUND` before scan;
- one Knowledge search increments `readCount` exactly once, mutation count stays 0;
- absent index performs initial refresh;
- dirty index attempts refresh before query;
- refresh failure with an existing usable cache returns `indexState:"stale"`, not a false `ready`;
- no usable index + inaccessible requested roots returns `unavailable`;
- maxResults clamps to <=50;
- output contains no adapterRef/native path/handle/bytes.

- [ ] **Step 2: Run the tool test and verify the new expectations fail.**

```bash
npx vitest run tests/unit/kiro-computer-tools.test.ts
```

Expected: FAIL because the 15th read tool/schema/executor branch does not exist yet.

- [ ] **Step 3: Register schema/tool/Activity label.**

Add `searchWorkspaceKnowledgeSchema` and register it in `COMPUTER_READ_TOOLS`. Add:

```ts
search_workspace_knowledge: "搜索工作区知识",
```

to `KIRO_TOOL_LABELS`.

No new capability is introduced; reuse `fs.search`.

- [ ] **Step 4: Implement a dedicated multi-root executor branch before the existing single-root generic resource path.**

The branch runs after frozen Workspace resolution and before constructing the normal single-root `resource`.

Algorithm:

```text
1. Parse requested rootIds; default = frozen snapshot roots in frozen order.
2. Reject any root id absent from frozen snapshot OR absent from current live Workspace.
3. For every requested root, evaluate current fs.search policy at root scope ".".
4. deny => that explicitly requested search cannot proceed for that root.
5. ask => reuse the existing exact approval lifecycle for that root; resume reruns the same frozen call.
6. Once all requested roots have search permission, consume exactly one readCount.
7. If index absent, bounded initial refresh.
8. If dirty, bounded incremental refresh (dirty means content fingerprints are not trusted for supported files).
9. Query local index and filter to requested roots.
10. Re-evaluate current exact-file fs.read for each ranked candidate before returning model-visible content evidence.
```

Approval remains non-mutating: approval-required consumes no read count and performs no refresh IO. Resume consumes the single read count only when search execution actually begins.

- [ ] **Step 5: Implement current-access filtering without body leakage.**

For each ranked candidate:
- `fs.read === allow`: keep full score, snippet, and content reasons.
- `fs.read === ask | deny`: remove `snippet`, remove `phrase`/`content-token` reasons, set score to `metadataScore` only.
- if the resulting metadata score is 0, drop that candidate entirely rather than leaking that hidden body content matched the query.

Do not auto-open a second approval solely to expose a Knowledge snippet. If the model needs content, it must call the ordinary live `read_text` / `inspect_document` tool, which uses the existing policy/approval path.

- [ ] **Step 6: Implement index-state degradation semantics.**

Use these exact rules:

```text
refresh succeeds, partial=false, dirty=false => ready
refresh succeeds, partial=true                => partial
refresh fails but prior files/chunks exist    => stale (query old cache with current-access filtering)
refresh fails and no usable prior cache       => unavailable
```

Never return `ready` after a failed refresh. Never turn a grant/root failure into an empty `ready` result.

- [ ] **Step 7: Run Task 2 tests and typecheck.**

```bash
npx vitest run \
  tests/unit/kiro-computer-tools.test.ts \
  tests/unit/kiro-knowledge-runtime.test.ts \
  tests/unit/kiro-knowledge-ranking.test.ts \
  tests/unit/kiro-workspace-instructions.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2.**

```bash
git add \
  lib/ai/computer/tools/schemas.ts \
  lib/ai/computer/tools/registry.ts \
  lib/ai/computer/executor.ts \
  lib/ai/tools/formatters.ts \
  lib/ai/computer/knowledge/service.ts \
  lib/ai/computer/knowledge/rank.ts \
  tests/unit/kiro-computer-tools.test.ts
git commit -m "feat(kiro): add workspace knowledge search"
```

---

### Task 3: Settings Knowledge Controls + Cleanup + Deterministic Offline E2E

**Files:**
- Create: `components/settings/KiroWorkspaceKnowledgePanel.tsx`
- Modify: `components/settings/KiroAgentSettings.tsx`
- Create: `tests/e2e/kiro-computer-knowledge-v3.spec.ts`
- Modify only if E2E exposes a real regression: existing targeted unit files from Tasks 1/2.

**Interfaces:**

`KiroWorkspaceKnowledgePanel` receives the active logical Workspace, and reads current Agent Mode/rules from `useKiroComputerStore`. It may call `getWorkspaceKnowledgeStatus`, `refreshWorkspaceKnowledge`, and `clearWorkspaceKnowledge`. It MUST use the existing `getComputerAdapterForAdapterRef` only client-side.

UI status mapping:

```ts
function knowledgeStatusLabel(state: KiroKnowledgeWorkspaceState | null): string {
  if (!state) return "未建立索引";
  if (state.dirty) return "需要更新";
  if (state.partial) return "部分索引";
  return "已就绪";
}
```

- [ ] **Step 1: Implement the compact Settings panel without adding an Explorer.**

Show only:
- indexed file count;
- chunk count;
- status: 未建立索引 / 已就绪 / 部分索引 / 需要更新;
- last indexed time;
- `建立索引` when state is absent;
- `更新索引` when state exists;
- `清除索引` when state exists;
- low-weight `KIRO.md 已启用` only when an exact root-level KIRO.md exists and current exact `fs.read` policy is `allow`.

`建立索引` and `更新索引` both execute a bounded `mode:"force"` refresh from Settings. This is an explicit user UI action, not a model tool, and does not consume Computer tool counters.

Use disabled/busy UI while a refresh/clear is running. Failure shows a concise toast; never claim success if refresh throws.

- [ ] **Step 2: Integrate panel and Workspace cleanup.**

In `KiroAgentSettings.tsx`, mount the panel for the active Workspace in the Computer Agent section, keeping existing Workspace authorization rows unchanged.

Extend `deleteWorkspace` cleanup order to:

```text
logical Workspace removal
→ remove Artifact metadata/source best effort
→ clear Knowledge metadata/chunks best effort
→ unique adapter cleanup (Sandbox namespace or Browser grant record)
```

Knowledge cleanup failure contributes to the existing “部分本地缓存未能清理” toast. It must never delete real Browser Workspace files.

- [ ] **Step 3: Add the deterministic offline E2E fixture.**

Create `tests/e2e/kiro-computer-knowledge-v3.spec.ts` with Sandbox fixture content:

```text
KIRO.md
research/literature.md
research/method.md
data/README.txt
```

Use exact body contents:

```text
KIRO.md: "方法论问题优先参考 research/method.md。"
research/literature.md: "文献综述与参考文献整理。"
research/method.md: "研究方法采用事件研究，并进行平行趋势检验。"
data/README.txt: "数据目录说明。"
```

Intercept `/api/ai/chat` with deterministic AI SDK-compatible streams. Assert the first submitted request contains:
- matching `computerSnapshot.workspaceId`;
- bounded `computerWorkspaceInstructions` for literal `KIRO.md`;
- no adapterRef / `sandbox-default` / native path / handle / arbitrary file bytes.

Script the assistant flow:

```text
search_workspace_knowledge({ query: "研究方法" })
→ result ranks research/method.md highly
→ read_text({ path: "research/method.md" })
→ final answer mentions 事件研究 + 平行趋势检验
```

The final answer must depend on the live `read_text` result, not merely the Knowledge snippet.

- [ ] **Step 4: Add E2E stale/refresh and KIRO.md non-index regressions.**

Within the same spec or a second test in the same file:
- open Settings and build index;
- change `research/method.md` externally in Sandbox to a same-byte-length alternate body without using a Kiro mutation;
- verify ordinary clean incremental assumptions may remain stale;
- click Settings `更新索引` and verify the force refresh finds the new text;
- verify Knowledge status/counts never include `KIRO.md` as an ordinary indexed file/chunk;
- remove the Workspace and verify Knowledge records are gone while Browser-file deletion behavior remains unchanged (Sandbox cleanup may remove Sandbox files as existing product behavior specifies).

- [ ] **Step 5: Run focused E2E and the full targeted V3 verification set.**

```bash
npx playwright test tests/e2e/kiro-computer-knowledge-v3.spec.ts
npx vitest run \
  tests/unit/kiro-knowledge-runtime.test.ts \
  tests/unit/kiro-knowledge-ranking.test.ts \
  tests/unit/kiro-workspace-instructions.test.ts \
  tests/unit/kiro-computer-tools.test.ts
npm run typecheck
```

Expected: PASS.

Do not run the entire Playwright/Vitest suite by default. Run `npm run build` only if a Next client/server bundling/import issue was encountered or typecheck cannot validate the boundary.

- [ ] **Step 6: Perform a focused static privacy/security audit.**

Run:

```bash
rg -n "computerWorkspaceInstructions|Workspace Instructions|search_workspace_knowledge" \
  app/api/ai/chat/route.ts hooks/useKiroChat.ts lib/ai/computer/knowledge lib/ai/computer/tools
rg -n "adapterRef|FileSystemDirectoryHandle|nativePath|native path" \
  lib/ai/computer/knowledge app/api/ai/chat/route.ts
```

Review matches manually. `adapterRef` is allowed only in client-side runtime plumbing such as injected adapter resolution; it must not occur in persisted Knowledge record types, search output, KIRO.md request entries, or server-generated Workspace Instructions.

Also verify there is no model-facing `delete_file`, shell, MCP, network, full-access, watcher, embedding, or vector-index tool added by this work.

- [ ] **Step 7: Commit Task 3.**

```bash
git add \
  components/settings/KiroWorkspaceKnowledgePanel.tsx \
  components/settings/KiroAgentSettings.tsx \
  tests/e2e/kiro-computer-knowledge-v3.spec.ts
git commit -m "feat(kiro): surface workspace knowledge controls"
```

If a focused test finds one integration bug after this commit, allow at most one additional narrow hardening commit such as:

```bash
git commit -m "fix(kiro): harden workspace knowledge boundaries"
```

Do not fold V3 Part 2 ideas into this closeout.

---

## Final Acceptance Checklist

- [ ] Local DB is exactly `classflow-kiro-knowledge-v1`; Workspace/file/chunk records contain logical metadata/bounded text only.
- [ ] 2,000 file / depth 12 / 2 MiB / 20 chunks-file / ~1,800 chars / 10,000 chunks / 20 default / 50 max limits are enforced and tested.
- [ ] Text-like files and DOCX are content-indexed when current exact-file `fs.read` allows it; unsupported/oversized/denied files are metadata-only.
- [ ] PDF remains metadata-only; no OCR was added.
- [ ] `KIRO.md` is never stored in ordinary Knowledge files/chunks/ranking.
- [ ] Browser KIRO.md is read client-side after the Computer snapshot is frozen; Server never opens Browser Workspace handles.
- [ ] KIRO.md is exact root-level only, stable multi-root order, 8k/root and 16k/turn bounded twice (client + server).
- [ ] Automatic KIRO.md load never opens an approval dialog; ask/deny/unavailable is non-blocking for ordinary chat.
- [ ] Server rejects/masks mismatched workspace/root/path/extra fields and rebuilds labels/order from frozen logical snapshot.
- [ ] Ordinary README/Markdown/DOCX data never becomes Workspace Instructions automatically.
- [ ] Verified create/patch/document update/rename/move and Undo attempts mark existing Knowledge index dirty best effort without changing verified filesystem outcomes.
- [ ] `search_workspace_knowledge` is `fs.search`, non-mutating, exposed in Plan/Guided/Workspace Auto, consumes exactly one Computer read count.
- [ ] Invalid root ids are rejected; root/grant failures are not silently converted to empty ready results.
- [ ] Current `fs.read` is re-evaluated for every returned candidate. ask/deny strips content evidence and drops content-only matches.
- [ ] Search results are candidates only; current content claims still use live read/inspect tools.
- [ ] Settings shows compact status/count/time/actions only; no Explorer or index management page.
- [ ] Settings `更新索引` is force refresh; `清除索引` removes Knowledge only.
- [ ] Workspace removal clears Knowledge best effort before adapter cleanup and never deletes real Browser files.
- [ ] Offline E2E demonstrates KIRO.md → Knowledge search → live read → final answer.
- [ ] Targeted Vitest/E2E and `npm run typecheck` are freshly passing before completion is claimed.

## Stop Boundary

Stop after the V3 Part 1 acceptance checklist is satisfied. Do **not** implement embeddings/vector search, nested KIRO.md, PDF body indexing/OCR, background watchers, semantic reranking, cross-Workspace search, shell/process execution, MCP, Tauri/Windows desktop runtime, Full Access, or a full file Explorer in this plan.
