# Image clipboard

Chat image context menus, the image viewer and its edited canvas share
`copyImageToClipboard` in `systemUtil.ts`.

- An image target with a source URL offers the image copy action on Web and
  desktop. The ordinary message copy action remains available on text targets.
  Copying `raw_message` from an image message writes its CQ representation.
- The Web entry calls `navigator.clipboard.write` synchronously within the
  click handler, with a `ClipboardItem` whose `image/png` value is a Promise.
  Image loading and canvas conversion resolve that Promise afterward. Awaiting
  them before starting the clipboard write can expire browser user activation.
- Each image copy captures its source before asynchronous work. A shared
  generation counter rejects older requests before delivering their image.
- Tauri writes PNG bytes through its existing native clipboard plugin and
  checks request ownership after asynchronous conversion and plugin loading.
- Loading, CORS, canvas conversion, capability and permission failures reach
  the initiating UI and produce a failure notice. Success follows a completed
  clipboard write.
- The viewer binds load/error handlers before assigning the image source,
  requests anonymous CORS and exports PNG. Its rotation and editing continue
  to use the selected image dimensions and current canvas.
- `yarn check` includes `test:image-clipboard`, which executes production
  functions with controlled browser/native adapters. Real browser clipboard
  formats and cross-application paste require separate acceptance.

The original repair lives in commits `500d121` and `65bec78`, submitted as
upstream PR #420 on 2026-10-26. The self-use integration must include this
repair independently of upstream PR merge status.
