# Goal

Maintain this OneBot QQ client. Current work prevents password-manager icons
from remaining after the OneBot login form is removed.

# Current State

- Baseline: `99be7d8` on `main`; GitHub remote is the user's
  `AlexbeatsZ/Stapxs-QQ-Lite-2.0` fork.
- Vue/TypeScript frontend; Yarn 4.12.0 is bundled in `.yarn/releases`.
- Individual forwarding now captures source bodies, normalizes images and waits
  for checked responses in chronological order. Sent callbacks match IDs/UUIDs;
  live self events preserve unrelated history.
- Same-second messages without a sequence retain insertion/backend order.
- Login form teardown hides individual inputs before removing the subtree, so
  KeePassXC-Browser can clean up its external icons while keeping autofill enabled.

# Active Work

- 2026-10-17: Web/Docker delegated (cross-origin) downloads lost file names:
  browsers ignore `download` on cross-origin links and NapCat returns QQ
  `ftn_handler` URLs with an empty `fname=`. The client fills `fname` only on
  `*.ftn.qq.com/ftn_handler/` URLs, percent-encoded with `encodeURIComponent`
  (`URLSearchParams` turned spaces into `+`). ROG `stapxs-qq` runs
  `stapxs-qq-lite:download-filename-20261017-b6a0634` (overlay of
  `keepass-login-20261015-970017b`, modules and relay meta retained, health
  `relayEnabled: true`); stopped `stapxs-qq-prev` kept for rollback.
  Verified in the user's Chrome with a real click: `被偷走的黎明_deepseek_1017 (1).html`
  saved with the exact name. Upstream PR
  [#414](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/pull/414) against `dev`
  (`codex/fix-web-download-filename`, source files only; upstream `dev` has no
  docs/tests for this module). Sourcery's QQ-only finding was addressed; the
  re-review and SonarCloud passed.
- Upstream PR [#412](https://github.com/Stapxs/Stapxs-QQ-Lite-2.0/pull/412)
  is open against `dev`: `3a96f5f` on `codex/fix-keepass-login-icons`, containing
  only the App.vue compatibility hook. Upstream check and `build --target esnext`
  passed; default build also fails on the unmodified upstream base because of
  its existing top-level-await/build-target mismatch.
- PR #412 AI review checked on 2026-10-15: Sourcery completed with no change
  suggestions or inline comments; SonarCloud quality gate passed with zero new
  issues/security hotspots. Copilot did not review because the requesting
  account had reached its quota. PR remains open for maintainer review.
- 2026-10-15: KeePassXC 1.10.4.1 DOM reproduction confirmed two orphaned icons
  with the original teardown. The input-style hook cleared one/two-field forms
  on navigation and app unmount, including returning to the login form.
- ROG `stapxs-qq` now runs `stapxs-qq-lite:keepass-login-20261015-970017b`
  at `8081:8080`, retaining the relay, runtime environment and deployed modules.
  Candidate and production relay health checks passed. The project check
  (lint/typecheck and 102 existing tests) and production build passed. On
  2026-10-15 the user confirmed successful real-browser acceptance of the login
  icon disappearance fix.
- Completed: forwarding/delivery fixes, 18 forwarding runtime regressions,
  lint/typecheck, session/quote/recalled-history checks, 7 file-transfer regressions
  and production build (2026-10-08).
- Acceptance boundary: Chrome tab automation timed out; native window control was
  disrupted by window changes and did not complete the forwarding workflow. No
  real QQ delivery is claimed. A local fixture used only synthetic records and
  was stopped and removed after the attempt.

# Build / Run / Test

- Install: `node .yarn/releases/yarn-4.12.0.cjs install --immutable`.
- Initialize bundled assets: `git submodule update --init`.
- Check: `node .yarn/releases/yarn-4.12.0.cjs check`.
- File transfer: `node .yarn/releases/yarn-4.12.0.cjs test:file-transfer`.
- Forwarding: `node .yarn/releases/yarn-4.12.0.cjs test:forwarding`.
- Build: `node .yarn/releases/yarn-4.12.0.cjs build`.
- Dev: `node .yarn/releases/yarn-4.12.0.cjs dev` (port 8080).
- Design references to read before changing their modules:
  [session history](docs/design/session-history.md),
  [quoted messages](docs/design/quoted-messages.md),
  [recalled history](docs/design/recalled-history.md),
  [file transfer](docs/design/file-transfer.md),
  [forwarding and delivery](docs/design/message-forwarding.md),
  [login autofill](docs/design/login-autofill.md).

# Durable Lessons

- The web build is a PWA (`autoUpdate`, skipWaiting + clientsClaim). After a
  deploy, the first reload still runs the old precached bundle; close the tabs
  or unregister the Service Worker before judging a fix in the browser.
- For automated download acceptance, use a real pointer click. A script
  `.click()` has no user activation, so the `target=_blank` delegated link is
  silently popup-blocked and nothing downloads.

- Controlled OneBot runtime regressions do not establish delivery through a
  logged-in QQ backend. Report that acceptance separately.
- Own-message events may precede acknowledgements, and body-fetch callbacks can
  arrive out of order. Bind UUID to real ID and deduplicate that record rather
  than guessing by the latest placeholder. OneBot message IDs are opaque.
