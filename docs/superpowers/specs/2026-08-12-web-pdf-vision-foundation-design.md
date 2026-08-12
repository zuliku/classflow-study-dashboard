# Task 19C1 — Web PDF Vision Foundation Design

Date: 2026-08-12
Status: Approved design, implementation not started
Repository: `zuliku/classflow-study-dashboard`

## 1. Goal

Prepare the foundation for reading scanned Web PDFs without changing Kiro's active chat model.

When `read_web_source` later encounters a scanned PDF, Kiro will use a dedicated OpenCode Go vision model to convert selected PDF pages into text evidence, then continue through the existing Web Evidence and page-aware Citation pipeline.

Task 19C1 only prepares configuration, credentials, validation, model selection, and server-side PDF page rasterization. It does **not** call a vision model and does **not** change `read_web_source` behavior yet.

## 2. Confirmed product decisions

- Vision provider: OpenCode Go only.
- Vision model: user-selectable from the project's OpenCode Go registry, restricted to models with `capabilities.vision === true` and `transport === "openai-chat"`.
- Default vision model: `mimo-v2.5`.
- Vision API key: separate user BYOK credential, stored in `sessionStorage` only.
- The vision key is not the active chat provider key and is never stored in Zustand persistence, history, backups, logs, or Tool Results.
- If vision is unavailable, missing a key, invalid, rate-limited, times out, or later fails to extract evidence, Task 19C2 will continue through the existing Tavily Extract fallback. Tavily success will use normal Web citations without trusted PDF page numbers.
- Main Kiro chat model remains unchanged. The vision model is an internal extraction worker only.

## 3. Target architecture

```text
web_search
  ↓
web-N
  ↓
read_web_source
  ↓
safeWebFetchPdf
  ↓
extractPdf
  ↓
possiblyScanned
  ↓
[Task 19C2]
WebPdfVisionRuntime
  ↓
server-side page rasterizer
  ↓
selected OpenCode Go vision model
  ↓
{ page, text }[]
  ↓
existing evidence chunking/ranking/budget
  ↓
availablePages
  ↓
[[source:web-N:pX]]
```

Task 19C1 implements only the configuration and rasterizer foundation below the `possiblyScanned` branch.

## 4. Configuration model

Add persistent non-secret preferences to `useKiroPreferencesStore`:

```ts
webPdfVisionEnabled: boolean;       // default true
webPdfVisionModel: string;          // default "mimo-v2.5"
```

These values may remain in the existing `classflow-kiro-preferences-v1` localStorage record. No store version bump is required.

Hydration must normalize old or invalid values:

- missing `webPdfVisionEnabled` → `true`
- invalid/missing `webPdfVisionModel` → `mimo-v2.5`

The model value must be validated against the OpenCode Go vision-model whitelist rather than trusted directly from persisted storage or request JSON.

## 5. Vision model registry

Create one provider-neutral helper for the allowed Web PDF vision models. It should derive from `OPENCODE_MODELS` instead of duplicating model metadata.

A valid Web PDF vision model must satisfy all of:

```text
provider === "opencode-go"
capabilities.vision === true
transport === "openai-chat"
```

The default is `mimo-v2.5`.

The Settings UI consumes the same helper used by server-side validation so model availability cannot diverge between UI and runtime.

The helper should expose deterministic normalized data such as:

```ts
interface KiroWebPdfVisionModelOption {
  id: string;
  name: string;
}
```

No remote model catalog is authoritative for this feature. The local registry remains the transport/capability authority.

## 6. Vision credential model

Add a dedicated session credential helper, separate from `getSessionApiKey("opencode-go")`.

Recommended storage key:

```text
classflow-ai-key:web-pdf-vision-opencode-go
```

Required helpers:

```ts
getSessionWebPdfVisionApiKey(): string
setSessionWebPdfVisionApiKey(apiKey: string): void
hasSessionWebPdfVisionApiKey(): boolean
```

Security requirements:

- `sessionStorage` only.
- trim before storing.
- empty value removes the key.
- never copy into Zustand.
- never include in history or Source metadata.
- never log.
- never include in Tool output.

## 7. Request snapshot and validation

`useKiroChat` should include the following in the request body snapshot:

```ts
webPdfVisionConfig: {
  enabled: boolean;
  model: string;
  apiKey?: string;
}
```

The key is attached only when non-empty.

Server request validation must treat every field as untrusted:

- `enabled` → boolean, default false when absent at the server boundary for backward compatibility.
- `model` → normalized through the local OpenCode Go vision-model whitelist; invalid values fall back to `mimo-v2.5` or cause the vision sub-runtime to be unavailable, but must never become an arbitrary provider model id.
- `apiKey` → transient string only; never returned in errors or logs.

Task 19C1 only validates and transports this configuration. It does not invoke the vision provider.

## 8. Settings UI

Add a compact advanced section near Kiro Web Search / reading settings:

```text
扫描 PDF 识别                         [开启]

Vision 模型
MiMo v2.5                         ▾

OpenCode Go Vision API Key
••••••••••••••••••••

仅用于读取联网搜索发现的扫描型 PDF。
密钥仅保存在当前浏览器会话中。
```

Behavior:

- model dropdown is disabled when scanned-PDF vision is disabled.
- API key field may remain editable while disabled, but disabling must not delete the session key.
- never display non-vision OpenCode models.
- do not expose internal terms such as OCR backend, Evidence Runtime, rasterizer, or Tavily fallback in the primary UI.
- no new visual design system; reuse existing Settings controls.

## 9. Server-side PDF rasterizer

The current `lib/ai/attachments/pdfVision.ts` renderer is browser-only because it depends on `document.createElement("canvas")` and `File`. It must not be imported into the server Web Reader path.

Add a separate Node-only module, recommended path:

```text
lib/ai/web/native/pdfVisionRasterizer.ts
```

It accepts already trusted PDF bytes/Blob from `safeWebFetchPdf` and selected page numbers, and returns transient image bytes:

```ts
interface KiroRasterizedWebPdfPage {
  page: number;
  data: Uint8Array;
  mediaType: "image/jpeg";
  width: number;
  height: number;
  size: number;
}
```

No `File`, object URL, temporary file, filesystem write, cache, or persistence.

## 10. Rasterizer implementation choice

Use `pdfjs-dist` for PDF page loading and a Node-compatible Canvas implementation. The preferred implementation is `@napi-rs/canvas`, because the project must remain a single Next.js Node service and the browser canvas renderer cannot execute in the server runtime.

This dependency is accepted only if all of these pass during Task 19C1 implementation:

- import works under the project's Node runtime;
- a small PDF page renders successfully in a targeted test or smoke script;
- `npm run typecheck` passes;
- `npm run build` passes;
- no browser bundle imports the native canvas package.

If `@napi-rs/canvas` fails these checks, stop and report the deployment incompatibility instead of adding Puppeteer, Playwright, a second service, or an unbounded native dependency workaround.

## 11. Rasterization limits

Web PDF vision is stricter than local attachment vision.

Add Web-specific limits:

```ts
MAX_WEB_PDF_VISION_PAGES_PER_READ = 3
MAX_WEB_PDF_VISION_IMAGE_BYTES_PER_READ = 4 * 1024 * 1024
MAX_WEB_PDF_VISION_DIMENSION = 1600
MAX_WEB_PDF_VISION_PAGE_BYTES = 1_500_000
WEB_PDF_VISION_JPEG_QUALITY = 0.82
```

These limits apply per `read_web_source` invocation. Existing Web Read limits already cap the user turn at two reads, therefore the maximum intended envelope is six rasterized pages and eight MiB of generated Web PDF page images per turn.

The rasterizer must:

- render only requested page numbers;
- ignore invalid/out-of-range pages safely;
- process pages sequentially or with a very small deterministic concurrency;
- keep the aggregate image-byte budget;
- lower image size/quality once when a page exceeds the single-page cap, mirroring the existing local scanned-PDF policy;
- skip a page that still exceeds the limit or fails to render, without leaking raw errors.

## 12. Page selection foundation

Task 19C1 may reuse pure page-selection helpers from `pdfVision.ts` where they have no browser dependency, especially explicit page parsing and bounded selection.

For future Task 19C2 behavior:

- explicit user page references have priority;
- otherwise select the first three pages;
- no full-document scan, OCR pre-pass, embedding, LLM page-search loop, or query-aware visual indexing in 19C1/19C2 V1.

Task 19C1 should expose a simple pure helper that Task 19C2 can call without depending on React or browser code.

## 13. Security and trust boundaries

The rasterizer receives bytes only after `safeWebFetchPdf` has already enforced URL/DNS/redirect/content-type/PDF-signature/size rules. Task 19C1 must not add a second downloader.

The future vision subrequest:

- will receive only selected page images and the `read_web_source.query`;
- will not receive ClassFlow business context, chat history, memories, Write tools, or Search tools;
- will not be able to authorize mutations;
- will treat image text as untrusted document content.

Task 19C1 must preserve this separation in interfaces so Task 19C2 cannot accidentally reuse the full Kiro system prompt/toolset.

## 14. Failure semantics

Task 19C1 defines normalized foundation errors but does not yet alter Web Evidence Runtime behavior.

The rasterizer should distinguish only what Task 19C2 needs, for example:

```text
WEB_PDF_VISION_DISABLED
WEB_PDF_VISION_KEY_REQUIRED
WEB_PDF_VISION_MODEL_UNAVAILABLE
WEB_PDF_VISION_RENDER_FAILED
WEB_PDF_VISION_NO_PAGES
WEB_PDF_VISION_BUDGET_EXCEEDED
```

These are internal runtime states. They should not be added to the public user-facing Web Search error enum unless required by an existing typed boundary.

Task 19C2 will map every vision-specific failure to the existing Tavily fallback path. Policy-blocked Safe Fetch failures remain non-bypassable.

## 15. Citation behavior

Task 19C1 does not change Citation logic.

Task 19C2 will only enrich `availablePages` when vision actually returns evidence for those pages. Therefore:

```text
Vision success on page 3
→ [[source:web-N:p3]] may become valid

Vision failure → Tavily success
→ [[source:web-N]] only
→ [[source:web-N:p3]] remains invalid
```

The `web-N` Source identity and original trusted search URL remain unchanged.

## 16. Testing strategy

Keep tests focused.

Task 19C1 automated coverage should include:

1. vision-model whitelist contains the default `mimo-v2.5` and excludes non-vision / non-openai-chat OpenCode models;
2. persisted invalid model normalizes to the default;
3. dedicated Vision API key helper uses a separate sessionStorage key and clearing it removes the key;
4. request validation rejects/arrests arbitrary vision model ids and never echoes a key;
5. rasterizer preserves page number, returns JPEG bytes, and obeys page/byte caps using a tiny fixture or injected test adapter;
6. rasterizer skips one failed page without aborting successful pages;
7. existing local browser `pdfVision.ts` behavior remains untouched.

Do not add Playwright or end-to-end provider tests in 19C1.

Required final verification:

```text
focused Vitest files
npm run typecheck
npm run build
```

A small Node runtime rasterizer smoke test is required if `@napi-rs/canvas` is added; remove any temporary script afterward.

## 17. Explicit non-goals

Task 19C1 does not implement:

- OpenCode Go vision API calls;
- `generateText` vision extraction;
- scanned Web PDF evidence generation;
- changes to `read_web_source` runtime behavior;
- Tavily fallback changes;
- Citation changes;
- PDF viewer;
- OCR engine;
- browser automation;
- Puppeteer / Playwright runtime;
- second server/service;
- Web PDF caching;
- image persistence;
- Native Search discovery;
- crawler or RAG.

## 18. Task split

### Task 19C1 — Web PDF Vision Foundation

Implements:

- Settings preferences and UI;
- separate Vision BYOK session credential;
- OpenCode Go vision-model whitelist/default;
- request snapshot + server validation;
- server-side bounded PDF rasterizer;
- focused tests and Node/build compatibility verification.

### Task 19C2 — Vision Extraction + Reader Integration

Will implement after 19C1 is verified:

- dedicated OpenCode Go vision extraction subrequest;
- scanned-PDF branch in Native Web PDF Reader;
- `{page,text}` normalization;
- existing evidence selection/budget reuse;
- `availablePages` propagation;
- Tavily fallback on every ordinary vision failure;
- real scanned-PDF smoke test and page-aware citations.

## 19. Acceptance criteria for 19C1

19C1 is complete only when:

- Settings exposes scanned Web PDF recognition with default MiMo v2.5 and only valid vision models;
- Vision API key is demonstrably independent and session-only;
- invalid model ids cannot reach the future provider call path;
- a server-side page rasterizer can render a bounded PDF page to JPEG bytes inside the current Next.js Node deployment model;
- rasterizer limits are enforced;
- existing Web PDF text reader and local scanned-PDF browser vision path are unchanged;
- focused tests pass;
- `npm run typecheck` passes;
- `npm run build` passes.

If the native Canvas dependency cannot satisfy the current deployment/build constraints, implementation must stop and report that limitation rather than silently broadening architecture.
