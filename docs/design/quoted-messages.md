# Quoted message originals

## Scope and interaction

Resolve an original message even when it is older than the current history page.
Visible reply cards fetch that original by ID and show its sender, timestamp and
compact body. Clicking a reply whose original is already rendered in `msgPan`
retains the existing scroll/highlight behavior. Otherwise it opens the complete
original in a dialog. Closing the dialog restores focus without scrolling the
chat. Keyboard activation, a focus trap, Escape and a return button are supported.

This feature does not load surrounding history, auto-page toward the original,
or insert a detached old message into `chatStore.messageList`. Context navigation
is deferred. Nested replies in body-only previews are hidden without mounting
another reply resolver. Merged forwards do not resolve missing IDs against the
currently active chat because their source conversation is unknown.

## Data and ownership

- `QuotedMessageLoader` deduplicates string/number IDs, caps active requests at
  two, and retains at most 128 completed entries with LRU eviction. Loading
  entries are retained until completion. Failures remain stable until an explicit
  click or retry, avoiding render-driven retry loops.
- The adapter invokes the active map's single-message action or `get_msg`, with
  a 10-second timeout. Normalize through the existing preview pipeline. Validate
  success status, original ID, sender, timestamp, message type and explicit group
  identity before normalization; validate the normalized ID/body afterwards.
  `message_type` is required. The [OneBot 11 get_msg specification](https://github.com/botuniverse/onebot-11/blob/master/api/public.md#get_msg-%E8%8E%B7%E5%8F%96%E6%B6%88%E6%81%AF)
  omits `group_id` from its response fields, so group identity is checked when an
  adapter supplies that extension rather than rejecting standard responses.
- The cache is in memory and resets synchronously on connection/login, account,
  adapter or chat changes, including replacement of the same chat object. Each
  reset advances a generation. Recheck it after network and normalization waits.
  This catches A -> B -> A without depending on PR #403's history implementation.
- Reset discards queued work and closes the dialog. Already-sent requests finish
  within the connector timeout and release their concurrency slots, but cannot
  repopulate the new cache. Closing just the dialog allows a same-session request
  to finish into the cache; it never reopens the dialog.
- A confirmed recall for the active conversation immediately clears the cached
  original, including responses still in flight. Other failures are described as
  unavailable or timed out, never assumed to be a recall.
- Original/preview DOM IDs use distinct prefixes so they cannot intercept the
  existing `chat-*` scroll lookup. The dialog sits below the image viewer and
  uses the existing body renderer for media and attachment interactions.
  The native dialog uses `open` with the existing overlay and manual focus trap;
  `showModal()` would put it above the application's image viewer in the browser
  top layer. Reply cards use a native button alongside their rich body so links
  and renderer markup are not nested inside a button. The compact body is inert;
  media and links are interactive in the complete original dialog.

## Verification

Run `yarn test:quoted-message`, `yarn check` and `yarn build` sequentially. The
Node tests exercise the production loader and single-message request adapter with
controlled network and normalization delays. Browser acceptance should cover a
visible missing quote, keyboard opening/closing, retry, a quote already rendered
in the main timeline, repeated references, recalls and a chat switch while a
request is pending. Check that no history action is sent by this feature and that
the main timeline and its scroll position remain unchanged when opening/closing
an unloaded original.
