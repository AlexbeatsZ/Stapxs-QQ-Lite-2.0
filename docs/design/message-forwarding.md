# Message forwarding and delivery correlation

## Scope

Individual forwarding must preserve selected message bodies and chronological
order, including mixed text/images. Single and merged forwarding share outgoing
image conversion. Sent-message callbacks also serve ordinary chat sends.

## Selection and sending

- Snapshot source messages before opening the destination; search uses its visible
  result list. Normalize selected IDs as strings. Selection click order must not
  change chronological order.
- Sort by timestamp and available sequence, preserving source order for ties.
  Message IDs are opaque and cannot be used as a chronological tie-breaker.
- Deep-copy the selection so confirmation, source normalization and chat switches
  cannot change its bodies or captured destination.
- Wait for each OneBot response and check success before sending the next item.
  Rejection or timeout stops the batch and reports the completed count. Do not
  automatically retry an ambiguous send.
- Dismiss confirmation and guard repeat clicks before sending. Recheck the visible
  destination before adding each local placeholder.
- `Connector.sendAndWait` retains the UI callback and awaits the same echo. Only
  actively awaited legacy echoes enter its response map; cleanup runs on success,
  timeout and dispatch failure. Native/WebSocket and HTTP/SSE retain their paths.

## Images and source ownership

Received image `url` is not an outgoing parameter. Copy a transferable URL into
`file` when the received file is a cache name. Retain explicit HTTP, file URI,
absolute path and `base64://` sources, convert image data URLs to `base64://`, and
preserve flash types. Do not rasterize remote images, which also preserves GIFs.
A cache name without a URL remains available for adapters supporting cached files.
A browser-only blob without a transferable source fails before batch sending.

The encoder copies segments before removing `type` and remapping `_type`; encoding
cannot mutate the timeline or snapshot.

Reference: [OneBot 11 image segments](https://github.com/botuniverse/onebot-11/blob/master/message/segment.md#图片).

## Delivery correlation

- An acknowledgement binds the exact local UUID to the real ID. A failed
  acknowledgement removes only that placeholder.
- Live self events update a matching message ID, sender and group, preserving its
  stable UI key. Never consume the latest placeholder or delete unrelated history.
- A self event before acknowledgement may temporarily add the real record. The
  acknowledgement merges it into its own placeholder and removes only duplicates.
- `getSendMsg` echoes carry real ID and local UUID. Update that exact placeholder,
  including index zero and backward response arrival. Recheck it remains in the
  active timeline after async normalization.
- Same-second messages without sequence retain backend/insertion order.

## Verification

Run `yarn test:forwarding`, `yarn check`, `yarn test:file-transfer` and `yarn build`.
The forwarding suite executes production dialog callbacks, encoder, send
callbacks, self-event handler and connector methods with controlled stores and
transport. It covers delayed responses, chat switches, search, backward arrival,
failures, image sources and source ownership. These checks do not establish real
QQ delivery, which requires a logged-in backend and designated test destination.
