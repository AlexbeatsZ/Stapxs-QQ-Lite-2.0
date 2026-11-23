# Goal

Maintain the self-use OneBot QQ web client and its ROG Docker deployment.
Keep current state and cross-device project history in the user's fork.

ROG must run the latest self-use integration from the user's fork, including
the user's completed repair PRs while they remain unmerged upstream. Include
these repairs in every deployment and verify the production bundle against
that integration. This requirement was confirmed on 2026-11-16.

# Current State

- Canonical repository is `AlexbeatsZ/Stapxs-QQ-Lite-2.0`. `main` integrates
  the image clipboard repair from `500d121`/`65bec78` (upstream PR #420),
  on top of download repair `25bacc8` and production integration `67a0a86`.
- On 2026-11-16 the ROG service runs source `e4c75b9` in
  `stapxs-qq-lite:image-clipboard-20261116-e4c75b9`, container `stapxs-qq`,
  port `8081 -> 8080`, `unless-stopped`, healthy with zero restarts and relay
  enabled. Its bundle is `main-Cil-_tTM.js`. Server-local and Mac-to-Tailscale
  page, exact bundle, PWA resources and relay checks pass. Existing modules
  and all runtime environment values were preserved.
- Latest published Web prerelease remains
  `selfuse-2026.11.15-download-filename`. For the image clipboard follow-up,
  the user requested deployment and service checks only.
- Current source includes server-perspective WebSocket relay, session/history
  and quoted-original fixes, ordered forwarding, file transfer/drop, login
  icon cleanup, SnowLuma device avatars, QZone background and cached-image
  forwarding via `get_image`.
- Download recurrence is reproduced from Chrome's real download record.
  `fname=/UUID` bypassed the old empty-only guard. The repair replaces or adds
  QQ `fname` using the original message filename, collapses duplicate/encoded
  keys and preserves unrelated raw query parameters. `yarn check` now includes
  file-transfer regressions.
- 2026-11-16 validation passed lint/types, 157 core/file-transfer/clipboard tests,
  5 relay tests and the modern-target Web build. A real QQ Range response
  changed from UUID/no extension to the original Chinese `.pptx` name and MIME.
- Historical logs from Mac, ROG, OMEN and five OMEN worktrees are merged into
  `docs/log/2026-09.md`, `2026-10.md`, `2026-11.md` and tracked in this fork.
- GitHub on 2026-11-15 shows PRs #403/#404/#405/#409/#410/#412/#414/#415/#416/
  #417/#424/#425 merged. On 2026-11-16 the user's only open upstream PR is
  image clipboard #420 at `65bec78`, now integrated into self-use production.
  Historical log entries retain their original dated acceptance boundaries.

# Active Work

- Image clipboard integration is deployed. Actual cross-application paste
  acceptance remains pending. Close and reopen existing QQ tabs to activate
  the new PWA bundle. The user narrowed this follow-up to deployment.
- Browser control bridge timed out twice. The new page's actual click-to-disk
  acceptance and real native platform downloads remain unverified. The original
  QQ URL later returned 403 during broader character-set header checks.
- Real QQ forwarding/recipient display, device notifications and native
  clipboard acceptance retain their historical user-acceptance boundaries.

# Workspace Locations

- Mac canonical repair checkout is
  `/Users/meta/Developer/Stapxs-QQ-Lite-2.0`.
- ROG production host is `meta@100.106.169.46`. Its original project checkout
  `C:\Users\Meta\Project\Workspaces\Stapxs-QQ-Lite-2.0` remains on old
  `pre-release@6fc8d250`, with unrelated pinyin/Dockerfile/modules changes.
  Build production from verified integration source and the actual live image.
- OMEN project checkout remains `codex/quoted-message-viewer@a696edc`; the root
  `C:\Users\Meta\Stapxs-QQ-Lite-2.0` clone is `main@ff2d0f4`. Latest prior
  self-use source lives in the `qq-device-presentation` managed worktree on
  `codex/deploy-forward-image`. These checkouts are historical working copies.
- Mac uses the Web build only. Local ignored `.env.yarn` sets
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1`; preserve shared Electron types used by
  tsconfig. The incomplete Electron runtime/cache was removed on 2026-10-23.

# Build / Run / Test

- Yarn 4.12.0 is bundled. Use `node .yarn/releases/yarn-4.12.0.cjs` for commands.
- Install dependencies with `install --immutable`; initialize pinned assets
  with `git submodule update --init` when missing.
- `check` runs lint/typecheck, session/quote/empty-history/forwarding, file
  transfer/drop and image clipboard regressions. `test:relay` covers the
  optional relay.
- Run `check` and `build --target esnext` sequentially. The upstream default
  target can fail on existing top-level await. `dev` serves port 8080.
- For deployment, overlay newly built Web assets onto the verified live relay
  image, retain deployed modules and relay metadata, preserve all runtime
  environment values and validate a candidate before switching port 8081.
- Verify server-local and Tailscale page/bundle/PWA/health after replacement.
  Release static Web ZIPs to this fork. Source-only upstream work keeps agent
  entry/log files excluded from the upstream PR branch.

# Durable Lessons

- A nonempty QQ `fname` can contain a cache identifier. Trust the original
  message/group-file name. Preserve raw unrelated query parameters and use
  encodeURIComponent because QQ treats `+` literally.
- PWA autoUpdate/skipWaiting/clientsClaim can leave an existing tab running an
  old bundle. Verify the loaded bundle, and close/reopen old QQ tabs to activate
  a new deployment before browser acceptance.
- Delegated cross-origin downloads require real pointer activation during UI
  acceptance; script-only clicks can be silently popup-blocked.
- A controlled fixture or native command-dispatch test does not establish real
  QQ delivery or native disk writes. Keep those acceptance results explicit.
- Preserve async request generations across A -> B -> A navigation. Correlate
  self-events/acknowledgements by exact opaque IDs/UUIDs and never replace
  unrelated history. Same-second messages without seq preserve backend order.
- ROG's old checkout does not represent current production. Inspect Docker and
  source lineage before rebuilding. Use uploaded PowerShell scripts for Windows
  remote operations; use Windows System32 tar for drive-letter archives.
- An open upstream PR can contain a completed fix absent from self-use main
  and production. Check source ancestry and the browser's loaded bundle when
  a previously repaired symptom recurs.
- A `$t` key with parameters must exist in `l10n/zh-CN.po`. Synthetic sends need
  at least one history message to resolve default `msg_type`.

# Docs Index

Read the matching design before changing its module.

- `docs/design/file-transfer.md` covers uploads/downloads and file drop.
- `docs/design/image-clipboard.md` covers chat/viewer/edit image copying.
- `docs/design/session-history.md` covers request ownership and paging.
- `docs/design/quoted-messages.md` covers original retrieval and positioning.
- `docs/design/recalled-history.md` covers empty/recalled pagination slots.
- `docs/design/message-forwarding.md` covers ordered forwarding and images.
- `docs/design/login-autofill.md` covers password-manager cleanup.
