# Recalled history and pagination

## Scope

Issue #408 affects history after a group accumulates recalled messages. NapCat
returns these as ordinary message records with an empty `message` array. They
still occupy the requested `count`: a latest window of 20 recalled records has
20 server records and zero readable bodies.

## Pagination and display

Retain empty historical records, including their IDs, timestamps and sequence
metadata, in the timeline. The existing full-page request count is based on
timeline length; dropping these records makes successive requests repeat the
same window. Render them with the existing unavailable-content notice rather
than guessing who recalled a message or reconstructing its content.

When the initial full-page response contains only empty records, request a
larger latest window with the adapter's mapped group/private action. Increase
the window by 20 raw records per request. Stop when readable content appears,
the window stops growing, the backend fails, or ten additional requests have
completed. Retained placeholders permit manual paging/retry after that bound.
Do not expand incremental adapters, previews, gap fills or live messages. The
initial callback explicitly requests expansion: Connector removes `echo` before
dispatch, so normalization cannot identify an initial response from that field.

Capture the chat object, account and adapter before normalization. Recheck that
scope before and after expansion I/O and normalization. Replacing the chat
object cancels the operation even when the next selection has the same ID.

Fresh empty records replace stale cached bodies with the same ID during merging.
An older response must not restore readable content over an empty record.

## Verification

Run `yarn check`, `yarn test:file-transfer` and `yarn build` sequentially. The
empty-history regression suite executes production normalization, application,
paging and unavailable-message detection with controlled I/O. It covers full
empty and mixed windows, multiple windows, private/group actions, stale cached
bodies, chat changes, backend errors, capped responses and request bounds.

Real acceptance on 2026-10-05 used 20 explicitly marked test messages in the
user-authorized group. All were successfully recalled. NapCat 4.18.28 returned
20 empty records for `count=20`, and 20 readable plus 20 empty records for
`count=40`. The deployed version displayed no messages after selecting the
group again. The final candidate automatically restored the 20 readable records
while retaining 20 unavailable placeholders; one manual older-page load then
displayed 31 readable records while retaining the same 20 placeholders. It ran
at an isolated origin with PWA registration removed and its bundle verified.
