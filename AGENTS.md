# Goal

Maintain this OneBot QQ client. Current work fixes individual forwarding order,
image payloads and sent-message reconciliation without changing destination chats.

# Current State

- Baseline: `cd3b67c` on `main`; GitHub remote is the user's
  `AlexbeatsZ/Stapxs-QQ-Lite-2.0` fork.
- Vue/TypeScript frontend; Yarn 4.12.0 is bundled in `.yarn/releases`.
- Individual forwarding now captures source bodies, normalizes images and waits
  for checked responses in chronological order. Sent callbacks match IDs/UUIDs;
  live self events preserve unrelated history.
- Same-second messages without a sequence retain insertion/backend order.

# Active Work

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
  [forwarding and delivery](docs/design/message-forwarding.md).

# Durable Lessons

- Controlled OneBot runtime regressions do not establish delivery through a
  logged-in QQ backend. Report that acceptance separately.
- Own-message events may precede acknowledgements, and body-fetch callbacks can
  arrive out of order. Bind UUID to real ID and deduplicate that record rather
  than guessing by the latest placeholder. OneBot message IDs are opaque.
