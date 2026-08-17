# Kiro Computer Agent V3 — Workspace Knowledge & KIRO.md Design

**Status:** Ready for user review  
**Date:** 2026-08-13

## Goal

V3 Part 1 adds a persistent local Workspace Knowledge layer so Kiro can identify relevant files without recursively traversing and grepping the whole Workspace on every turn. Root-level `KIRO.md` becomes the explicit Workspace instruction file.

This phase is lexical/local only: no embeddings, vector DB, cloud indexing, background watcher, shell, MCP, or desktop runtime.

## Existing baseline

V2 already has authorized Workspaces/Roots, Browser and Sandbox adapters, file/document read tools, Artifact lifecycle, permission modes, approval flow, and safe Artifact Context.

Current discovery is request-time only:

- `search_files`: recursive filename/path matching;
- `grep_files`: bounded literal text scan.

There is no durable Workspace content index and no implemented `KIRO.md` layer.

## Chosen architecture

Add:

```text
lib/ai/computer/knowledge/
  types.ts
  db.ts
  scanner.ts
  extract.ts
  tokenize.ts
  rank.ts
  service.ts
```

The Knowledge layer is a search accelerator, not filesystem authority. Search results are candidates; current content-dependent claims still require `read_text` or `inspect_document`.

## Persistence

IndexedDB:

```text
classflow-kiro-knowledge-v1
```

Stores:

```text
workspaces
files
chunks
```

Workspace state tracks `workspaceId`, last indexed time, file/chunk counts, `partial`, and `dirty`.

File records store logical identity only: `workspaceId`, `rootId`, `relativePath`, extension/type, size, title when available, fingerprint, content status, and indexed time.

Chunk records contain bounded extracted text plus deterministic lexical token counts.

Never persist native paths, adapter refs, filesystem handles, grants, chat history, model prompts, Artifact source IR, or unbounded full files.

## Fixed V3 Part 1 limits

- max 2,000 discovered files per Workspace refresh;
- traversal depth max 12;
- content indexing only for files <= 2 MiB;
- max 20 chunks per file;
- target chunk size about 1,800 characters;
- max 10,000 chunks per Workspace;
- search default 20 results, hard cap 50.

If a bound is reached, state becomes `partial=true`; already indexed content remains usable.

## Supported content

Text-like files reuse the existing text extension policy where practical.

DOCX reuses the existing Mammoth raw-text extraction path. No HTML/OOXML is stored.

PDF and other unsupported binary files are metadata-only in V3 Part 1. No OCR or PDF text indexing is added.

## Incremental refresh

Refresh modes:

```ts
"incremental" | "force"
```

A cheap fingerprint is derived from logical path and available metadata such as size/type. If the adapter does not expose reliable modification time, the fingerprint must not be treated as proof of freshness.

Incremental refresh reuses records whose available fingerprint matches. Force refresh re-extracts supported files within the normal bounds.

After a scan:

- new/changed files replace their chunks atomically;
- files no longer observed are removed from the index;
- unsupported/oversized files remain metadata-only;
- extraction failure marks only that file as failed unless the Root itself is inaccessible.

No polling or filesystem watcher is introduced.

## Dirty tracking

Verified Kiro file mutations mark the Workspace Knowledge state `dirty=true` on a best-effort basis. This includes create, patch/update, rename/move, and Undo that changes file state.

A Knowledge DB failure must never retroactively fail an already verified filesystem operation.

The next Knowledge search attempts bounded incremental refresh before querying when state is dirty.

## Tokenization

No search dependency is added.

Normalization:

- Unicode normalization;
- lowercase Latin;
- normalized whitespace/punctuation boundaries.

Tokens:

- Latin/numbers: word tokens;
- CJK: overlapping 2-gram and 3-gram tokens;
- preserve normalized query phrase for phrase scoring.

## Lexical ranking

Deterministic score components:

1. exact filename match;
2. filename token match;
3. path token match;
4. title match;
5. exact phrase occurrence in chunk;
6. query token overlap;
7. bounded term-frequency contribution.

Do not use unreliable filesystem recency as a ranking signal.

Return small `matchReasons` values such as `filename`, `path`, `title`, `phrase`, and `content-token`.

## New read tool

Add one model-facing read tool:

```text
search_workspace_knowledge
```

Capability: `fs.search`  
Mutation: `false`

Input:

```ts
{
  query: string;
  rootIds?: string[];
  maxResults?: number;
}
```

Output:

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

The tool is available in Plan, Guided, and Workspace Auto under the existing read-policy boundary.

It performs candidate discovery only. Bounded snippets can be stale; Kiro must perform a live read before relying on current file content. Requested roots must belong to the frozen active Workspace.

## Search lifecycle

On `search_workspace_knowledge`:

1. resolve frozen Workspace and requested Roots;
2. load Knowledge state;
3. if absent, run initial bounded refresh;
4. if dirty, attempt bounded incremental refresh;
5. query the local index;
6. return candidates and explicit index state.

Root/grant failures are explicit errors/unavailable states, not silent empty results.

## Root-level KIRO.md

V3 Part 1 recognizes exactly:

```text
<authorized-root>/KIRO.md
```

No nested or inherited instruction files yet.

In a multi-root Workspace, valid root-level KIRO.md files are merged in stable Workspace root order with source Root labels.

`KIRO.md` is excluded from ordinary Knowledge chunks and ranking.

## KIRO.md turn lifecycle

When Computer is enabled and the turn has a frozen active Workspace, each new turn reads live root-level KIRO.md files through the existing authorized adapters.

Bounds:

- max 8,000 characters per Root;
- max 16,000 characters total per Workspace turn.

Missing KIRO.md is normal. Oversized content is truncated and marked. An inaccessible Root must never result in fabricated instructions.

KIRO.md contents are not persisted in chat history, Zustand, Artifact metadata, or Knowledge DB. Changes therefore take effect on the next turn without index refresh.

## Instruction precedence

Effective order:

```text
System/developer safety and product policy
> explicit current user request
> KIRO.md Workspace Instructions
> ordinary Workspace Knowledge/tool data
```

KIRO.md may define project conventions, preferred directories, writing/code style, and files/workflows to prioritize.

It cannot expand authorized Roots, grant capabilities, bypass approval, change Agent Mode, enable unavailable system capabilities, or override higher-priority safety policy.

## Prompt-injection boundary

Only exact root-level `KIRO.md` is promoted to Workspace Instructions.

README files, source files, Markdown documents, DOCX text, and all other indexed content remain untrusted workspace data. Text inside those files must never automatically become instructions.

## Server prompt construction

When valid KIRO.md exists, create a server-generated section:

```text
# Workspace Instructions

These instructions were read from root-level KIRO.md files in the user-authorized Workspace.
They guide work inside the Workspace but grant no permissions and cannot override system/developer safety policies or the user's explicit current request.

## Root: <label> (<rootId>)
<bounded KIRO.md content>
```

The client must not be able to send an arbitrary trusted `workspaceInstructions` body field. Trusted instruction loading is derived from the frozen Computer Workspace and live adapters.

## UI

Settings → Kiro Agent → current Workspace adds a compact `工作区知识` block showing:

- indexed file count;
- chunk count;
- state: not indexed / ready / partial / needs update;
- last indexed time;
- `建立索引` or `更新索引`;
- `清除索引`.

If a root-level KIRO.md is detected, show a low-weight `KIRO.md 已启用` status.

No full Explorer, index-management page, or KIRO.md editor is added.

## Workspace cleanup

Clearing Knowledge removes only Knowledge DB metadata/chunks for that Workspace. Existing files and Artifact records are unaffected.

Existing Workspace removal also clears its Knowledge records best-effort.

## Security and privacy

The index remains local in browser IndexedDB. Model-visible index data appears only through explicit bounded `search_workspace_knowledge` tool results.

Do not inject the whole index into every turn and do not call external services to build the index.

## Testing

Unit coverage must include:

- DB replacement/removal;
- incremental versus force refresh;
- stale file removal;
- file/depth/chunk limits;
- text/DOCX extraction;
- metadata-only unsupported/oversized files;
- Latin and CJK tokenization;
- deterministic ranking;
- root filtering;
- dirty state;
- KIRO.md per-root/total bounds;
- deterministic multi-root merge order;
- KIRO.md exclusion from ordinary search;
- Workspace cleanup.

Tool/runtime coverage must prove:

- visibility in all Agent modes as a read tool;
- no mutation quota usage;
- invalid roots rejected;
- absent/dirty index refresh behavior;
- bounded snippets and candidate-only semantics.

Server prompt coverage must prove:

- only live KIRO.md enters trusted Workspace Instructions;
- fake client instruction fields are not trusted;
- normal documents never become instructions;
- no native path/handle/adapter-ref leak.

Offline E2E fixture:

```text
KIRO.md
research/literature.md
research/method.md
data/README.txt
```

KIRO.md tells Kiro to prefer `research/method.md` for methodology questions. The expected flow is:

1. live KIRO.md loads for the turn;
2. Kiro calls `search_workspace_knowledge("研究方法")`;
3. `research/method.md` ranks highly;
4. Kiro calls `read_text` for that path;
5. final answer uses the live read result.

## Implementation boundaries

At most three cohesive implementation parts:

1. **Knowledge Runtime & KIRO.md** — DB, scanning, extraction, tokenization/ranking, refresh/status/clear, dirty marks, live KIRO.md loading and trusted prompt section.
2. **Knowledge Search Tool** — schema/registry/executor integration, refresh-before-search, root filtering, bounded candidate results.
3. **Settings Status & Offline E2E** — compact index status/actions, KIRO.md indicator, Workspace cleanup regression, deterministic offline E2E.

Do not fragment the work further by default.

## Explicit non-goals

- embeddings/vector search;
- semantic reranker;
- cloud index;
- background watcher/polling;
- cross-Workspace search;
- nested KIRO.md;
- PDF content indexing/OCR;
- shell/git indexing;
- Windows/Tauri;
- MCP;
- full file explorer;
- automatic whole-Workspace prompt injection;
- KIRO.md editor.

## Success criteria

V3 Part 1 is complete when:

- Kiro can use a bounded persistent local lexical index for candidate discovery;
- refresh is bounded/incremental and filesystem remains authoritative;
- current content claims still use live reads;
- root-level KIRO.md is reread live each turn and injected as bounded Workspace Instructions;
- ordinary files never become instructions;
- KIRO.md does not expand permissions or override higher-priority policy;
- no embeddings/cloud indexing/native-path leakage is introduced;
- Settings exposes compact index status/actions;
- offline tests demonstrate KIRO.md → Knowledge search → live read → final answer.
