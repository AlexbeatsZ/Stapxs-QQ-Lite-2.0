# Login form and password-manager icons

The OneBot connection form supports browser password-manager autofill. Keep this
available before connecting; do not disable KeePassXC for the site or change the
token's password input type to hide its icon.

## Teardown

The Home tab is conditionally mounted. Successful login switches to Messages,
and navigating to Settings also removes Home. The form's
`@vue:before-unmount` hook must set `display: none` on each input before Vue
removes the parent subtree. Keep this hook on the form so it also runs when the
whole app unmounts.

KeePassXC-Browser 1.10.4.1 creates icon wrappers outside the form, using closed
shadow roots. Its username icon stops its IntersectionObserver when switching
icon state. Its MutationObserver removal handler ignores already identified
inputs when searching inside a removed ancestor, so removing the form alone can
leave icons behind. An inline style mutation on each input takes its direct-input
path and lets the extension delete its own hidden icons. Hiding only the parent
does not reliably trigger that path.

Do not remove extension nodes, inspect password-manager state, dispatch fake
extension messages, or add a page-wide MutationObserver. The compatibility hook
only changes the application's inputs immediately before their normal removal.

## Validation and deployment

- Run the project check and production build after changing the hook.
- On 2026-10-15, a temporary DOM fixture loaded the installed extension's actual
  `observer-helper.js` and `icon-handler.js`, with synthetic tracked inputs and
  external icon hosts. Original Vue subtree removal left two icons. The hook
  cleared one/two-field forms on tab navigation and app unmount; returning to the
  form created visible inputs. This models the stopped visibility observer and
  does not establish acceptance in the user's actual Chrome session.
- Real acceptance: refresh the deployed client, use KeePassXC normally, connect,
  and verify that the icon disappears in Messages and over the update dialog.
  Leaving Home for Settings and reconnecting should also work.
- ROG's `stapxs-qq` service uses port `8081:8080` and an existing relay image.
  Build an overlay from the running image, replace its web assets, retain its
  `modules/` directory and relay-enabled index metadata, and preserve its runtime
  environment/port/restart configuration. Do not rebuild from the stale ROG
  `pre-release` checkout, which also has unrelated uncommitted changes.
- Deployed on 2026-10-15: `stapxs-qq-lite:keepass-login-20261015-970017b`,
  based on `stapxs-qq-lite:recalled-history-20261005-cd3b67c`. Candidate and
  production `/_stapxs/health` both reported `relayEnabled: true`. Project lint,
  typecheck, 102 existing tests and the production build passed. User Chrome
  acceptance remains open.
