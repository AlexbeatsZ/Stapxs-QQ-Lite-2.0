# File transfer reliability

## Scope

This document covers chat file uploads and downloads across Web, Electron,
Tauri, and Capacitor. The path-map entry remains the capability boundary for
OneBot-specific upload extensions.

## Upload invariants

- Capture the destination chat before reading or uploading a file. An async
  result must never be sent to whichever chat happens to be visible later.
- Prefer `file_upload_stream` only when the active OneBot path map advertises
  it. Chunks are sent sequentially so memory and WebSocket payload size remain
  bounded.
- A failed or cancelled stream is reset on the OneBot side. Cancellation is
  checked again after stream finalization and before the completed path is
  passed to the mapped group/private upload action.
- Inline Base64 is a compatibility fallback for files no larger than 8 MiB.
  Larger files fail with an actionable error when streaming is unavailable;
  they must not be packed into one oversized WebSocket frame.
- A transfer task becomes completed only after OneBot reports success. A
  rejected OneBot response is a failed task, even if the browser finished
  reading the source file.
- The task enters a non-cancellable finalizing state immediately before the
  mapped OneBot send action. Once that action starts, the protocol cannot
  reliably retract the file, so the UI must not report a late cancellation.

## Download invariants

- Electron and Tauri events carry a transfer task ID. Progress, completion,
  cancellation, and failure events must be consumed only by the matching task.
- Tauri download commands start only after every asynchronous event listener
  reports that it is ready; terminal events must not race listener setup.
  Electron registers listeners synchronously.
- Native backends reduce remote file names to a base name before joining them
  to the user-selected download directory.
- Electron associates redirects through the complete URL chain, because the
  final `DownloadItem` URL can differ from the requested URL.
- Native downloads stream to disk and emit an explicit terminal event. Tauri
  cancellation stops the Rust stream, and Tauri removes a partial output file
  after cancellation, request failure, or write failure.
- Cross-origin Web downloads are delegated to the browser download manager.
  This avoids XHR CORS failures, whole-file buffering, and application-level
  timeouts. Delegated tasks cannot provide reliable in-app progress.
- Browsers ignore the `download` attribute on cross-origin links, so a
  delegated download is named by the server. NapCat returns QQ `ftn_handler`
  URLs with an empty `fname=`. SnowLuma can instead return a nonempty `fname`
  containing `/UUID`, which QQ also uses as the download name. The client uses
  the original chat/group-file name for every QQ download, replacing existing
  `fname` values and adding it when missing, so the QQ server sends
  `Content-Disposition` with that name. Only
  `*.ftn.qq.com/ftn_handler/` URLs are rewritten: other endpoints may give
  `fname` its own meaning or sign it. Encode the name with `encodeURIComponent`:
  the QQ server keeps `+` literally, so `URLSearchParams` form encoding turns
  spaces into `+` in the saved name. Replace only the `fname` parameters: re-serializing the
  whole query with `URLSearchParams` would also rewrite other parameters
  (`%20` becomes `+`). Remove all duplicate and percent-encoded `fname` keys
  before appending one canonical value, keeping other raw parameters in order.
  A literal `+` in a name must be sent as `%2B`. The same
  `+` ambiguity previously broke saved access tokens at login (PR #380). Without it the browser
  names the file after the URL path and the extension is lost.
- Chat, private and group-file download callbacks capture the original name in
  the request echo. `startFileDownload` decodes it and `FileManager` forwards it
  unchanged to the shared download function. Browser and Capacitor handoffs
  share QQ URL naming; same-origin/blob and native backends keep their existing
  explicit filename paths. Never derive the download name from the file ID or
  from an adapter's temporary/cache path.
- `yarn check` includes `test:file-transfer`. Its regressions cover missing,
  empty, placeholder, stale, duplicate and encoded `fname` parameters, original
  Unicode/space/plus/percent/special-character names, raw signed-query
  preservation, and production entry functions through browser handoff and
  native command dispatch. Native platform and actual browser disk writes
  require separate acceptance.
- Same-origin Web downloads retain in-app progress, have no fixed timeout, and
  surface Promise rejection instead of leaving a task permanently active.

## Compatibility boundaries

- The bundled Capacitor connector has no native download command or terminal
  events. Capacitor therefore uses the browser-managed path; cross-origin
  downloads are delegated and cannot report reliable in-app progress.
- Adding a streaming action to another OneBot implementation requires a path
  map entry with the action names and a safe chunk size. Do not infer support
  from a product name in UI code.
