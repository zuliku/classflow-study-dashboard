# Kiro Mini V2 — 常驻桌面 Companion

Date: 2026-11-05
Status: Implemented (Phase A + B)

## 1. Positioning

Kiro Mini is a separate persistent `BrowserWindow` (`?mini=1`) that mirrors the active main-window conversation. It is a companion/remote control, **not** a second agent runtime:

- chat truth remains in the main window `useKiroChat`;
- Mini never calls the local model API, never executes tools, never writes data;
- all commands pass through the main process relay and the existing main-window runtime;
- closing the main window closes Mini (no orphan runtime).

## 2. Window model

- Expanded: 340×560 default (clamped 300×440–560×900); frameless, transparent, always-on-top by default, skipTaskbar. The expanded size is fixed for the session (transparent windows are not reliably user-resizable on Windows).
- Capsule: 72×72, draggable, single-layer surface: logo + one status dot (busy/waiting only) + optional unread pill; top-left hide control appears on hover. No nested card/button chrome.
- Mode is persisted in `mini-chat-bounds.json`; expanded size is preserved separately.
- **No per-frame native window resizing.** The window is transparent with no native shadow. On expand, Main instantly grows the native window to the expanded size at the same top-left; the added area is fully transparent. On collapse, the window stays expanded until the card has shrunk, then instantly shrinks to 72×72; the removed area was already transparent. Both native bounds changes are invisible.
- The visible card performs the actual morph with a CSS `width/height` animation inside the fixed window: expand 260 ms / collapse 200 ms, `cubic-bezier(0.4, 0, 0.2, 1)`. The target layout mounts on the card animation's `animationend` (fallback timer if interrupted).
- The logo is a shared element: it flies between the capsule center (28 px) and the expanded header's top-left mark (20 px) using GPU transforms, so the header handoff is seamless.
- Expanded and capsule surfaces use the same 20 px radius and inset ring; only the card paints, the rest of the window is transparent.
- Bounds are clamped to the current display work area on show, `ready-to-show`, display removal and metric changes.
- `Ctrl/Cmd+Shift+K` toggles Mini.
- Tray: show Mini / open ClassFlow / quit. Closing the main window closes Mini and quits.
- While a turn is in flight, the main window's background throttling is disabled so streaming completes reliably even when the main window is minimized/hidden; it is restored when the turn settles.

## 3. Snapshot V2

`MiniChatSnapshot` v2 adds:

- `title`, `phase`, `status`, `plan`, `activity`, `sources`, `approval`, `suggestions`, `conversations`, `transitioning`;
- per-message `streaming` for the last assistant message;
- message cap 40, per-message text cap 6000, conversation cap 8.

Telemetry is projected by a pure `deriveMiniTelemetry` helper from safe runtime facts:

- `KiroActivity` semantic labels only;
- persisted execution-plan metadata;
- source registry metadata (no content/snippet/provider raw data);
- no tool input/output, paths, task/tool IDs.

Status labels: 正在思考 / 正在{当前工具} / 正在整理回答 / 正在回答 / 等待确认 / 出错了.

## 4. Commands

Mini → main process → main window:

- send / stop (existing);
- new chat;
- switch conversation;
- focus main (main process restores/focuses main window, renderer loads target conversation);
- resolve approval (`deny` / `allow-once` only).

All channels validate sender id + trusted renderer URL in Main; send uses requestId ack with timeout.

## 5. Approval policy

Mini can directly handle **low-risk, foreground, allow-once** approvals:

- `!presentation.highRisk`;
- `background !== true`;
- `allowedDecisions` contains `allow-once`.

Main process validates the current snapshot approval id + `canApproveInMini`; the main-window relay validates the live `pendingApproval` again before calling `resolveApproval`. High-risk / background / session/workspace approvals remain read-only in Mini with a "主窗口处理" handoff.

## 6. UI

Expanded layout:

1. Header: Kiro mark, conversation title/dropdown, busy status + elapsed, new chat, pin, collapse, hide.
2. Status strip: low-risk approval card, plan progress, current activity, source chips.
3. Messages: Markdown-lite (paragraphs/lists/code copy/links/tables; no HTML, images, Mermaid/KaTeX/charts), streaming caret, sticky-bottom auto-follow, "新内容" control, copy last answer when settled.
4. Composer: quick prompts (click sends immediately), attachment tray, paste image, auto-height textarea, send/stop.
5. Conversation menu: recent conversations, new chat, open main.

Capsule layout: 72×72 single surface, centered Kiro mark, one status dot when busy/waiting, optional unread count, hover-revealed hide control; the rest of the surface is the native drag region.

## 7. Notifications / tray

- On busy true→false while Mini is hidden/not focused and main is not focused, Main shows a system notification "Kiro 已回答" with a text preview; click shows Mini.
- Tray menu provides show Mini / open ClassFlow / quit.
- App user model id is set for Windows notifications.
- Tray icon is packaged via `extraResources` (`build/icon.png`).

## 8. Performance

- Snapshot publish throttled to 150ms.
- Snapshot caps reduce IPC payload.
- Mini only mounts its own thin UI; no chat runtime.
- Main background throttling off only while needed.
- Window bounds changes are short and reduced-motion aware.
- No per-token Markdown full reparse (Mini Markdown is small; message rows are memoized).

## 9. Security invariants

- No model API capability in Mini.
- No direct tool execution / writes / approval bypass.
- Only http(s) links open externally; internal navigation is trusted-renderer-only.
- Approval ID is the only internal identifier exposed to Mini; task/tool-call IDs, paths, inputs/outputs stay in Main/main window.
- Attachment limits and base64 validation unchanged.

## 10. Testing

- Pure: protocol v2, telemetry, sanitize, base64.
- UI: status/plan/approval/quick prompt/capsule, conversation menu.
- Main/preload contract: channels, sender trust, low-risk approval gate, close/background/throttle.
- E2E: `?mini=1` with mock bridge for expanded/capsule, approval, quick prompt.
