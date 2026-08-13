# Kiro V3 Knowledge Implementation Clarification

This note takes precedence over conflicting transport details in the V3 Workspace Knowledge design.

For browser-backed workspaces, `KIRO.md` is loaded by the client-side Computer runtime after the turn workspace snapshot is frozen. The request carries a bounded typed context containing the matching workspace ID, root ID and label, the fixed path `KIRO.md`, bounded text, truncation information, and an availability status.

The server validates this context against the frozen logical workspace snapshot, restores stable root order, applies the 8,000-character per-root and 16,000-character total limits again, and builds the Workspace Instructions section. The server does not directly read browser-backed workspace files.

Automatic `KIRO.md` loading follows the current file-read decision for the exact path. It loads when allowed. When the file is unavailable or would require an interactive decision, it is omitted for that turn and ordinary chat continues. A missing file is normal.

Knowledge search is also checked against current access decisions at query time. Indexed body snippets are returned only when current file reading is allowed for that exact path; otherwise an allowed search may return metadata only. Current content claims still require a live `read_text` or `inspect_document` call.

The index remains a candidate cache rather than a freshness authority. Verified Kiro file changes mark it for refresh on a best-effort basis. Settings `更新索引` performs a bounded force refresh, which is the repair path for external edits that a metadata-only incremental comparison cannot detect.

`search_workspace_knowledge` counts as one Computer read/search tool call. Internal bounded refresh work is implementation detail rather than one model tool call per scanned file.

Tests must cover frozen-workspace KIRO.md loading, deterministic multi-root ordering and limits, server-side revalidation, non-blocking unavailable KIRO.md behavior, current-access filtering of Knowledge snippets, force refresh behavior, and exclusion of KIRO.md from ordinary Knowledge indexing.
