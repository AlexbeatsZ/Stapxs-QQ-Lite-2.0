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

## Drag-and-drop upload

- While the chat panel is visible, files dragged from outside the page onto any
  part of the window go to the open chat. Window-level capture listeners live
  in `Chat.vue`; pure helpers and tests are in `fileDropUtil.ts` and
  `tests/file-drop.test.mjs`.
- QQ-displayable images (JPEG, PNG, GIF, WebP, BMP) follow the paste path
  (`setImg`): they join the draft and are sent with the next message. Other
  files, including SVG and HEIC, follow the file button path
  (`confirmSendFile`), with the same 1 GB confirmation. Folders are skipped
  with a notice; detect them with `webkitGetAsEntry()` during the `drop` event.
- `setImg` reads the image before it adds the placeholder and the cached data
  together. Staging the placeholder first let a draft sent during the read
  carry it away, and the late read then slipped the image into a later
  message. Dropped images are read one at a time to keep their order.
- The base64 compatibility upload (no stream mapping, or a stream failure for
  files of at most 8 MB) sends the file as its own message with
  `sendParsedMsg`. It must not clear `msg`, `sendCache` or `imgCache`: that
  discarded draft text, a pending reply and images dropped with the file.
- `ignore` (not external files, or the panel is hidden by `v-show`) leaves the
  browser default alone, and hides an overlay that is still shown. `block`
  (sidebar open, pop box shown, message search, mute still active, compared
  with `Date.now()`) still calls `preventDefault` so the browser does not open
  the file and leave the app, but sends nothing and shows no overlay.
- Drags that start inside the page (message images, which also carry `Files`)
  are not uploads: `dragstart` adds the `application/x-ssqq-internal-drag` type
  to their data. Do not use a flag reset on `dragend`: a source removed during
  the drag gets no `dragend`, and the stuck flag made later external drops be
  ignored, so the browser opened the file.
- The overlay is hidden when the tracked `dragenter` targets are all left
  (detached targets are pruned) and, as a fallback, when no `dragover` arrives
  for one second.
- Tauri intercepts native file drops unless `dragDropEnabled` is turned off,
  so the HTML5 drop events may not reach the page there.

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
  URLs with an empty `fname=`; the client fills it with the file name so the QQ
  server sends `Content-Disposition` with that name. Only
  `*.ftn.qq.com/ftn_handler/` URLs are rewritten: other endpoints may give
  `fname` its own meaning or sign it. Encode the name with `encodeURIComponent`:
  the QQ server keeps `+` literally, so `URLSearchParams` form encoding turns
  spaces into `+` in the saved name. Replace only the `fname` segment: re-serializing the
  whole query with `URLSearchParams` would also rewrite other parameters
  (`%20` becomes `+`). A literal `+` in a name must be sent as `%2B`. The same
  `+` ambiguity previously broke saved access tokens at login (PR #380). Without it the browser
  names the file after the URL path and the extension is lost.
- Same-origin Web downloads retain in-app progress, have no fixed timeout, and
  surface Promise rejection instead of leaving a task permanently active.

## Compatibility boundaries

- The bundled Capacitor connector has no native download command or terminal
  events. Capacitor therefore uses the browser-managed path; cross-origin
  downloads are delegated and cannot report reliable in-app progress.
- Adding a streaming action to another OneBot implementation requires a path
  map entry with the action names and a safe chunk size. Do not infer support
  from a product name in UI code.
