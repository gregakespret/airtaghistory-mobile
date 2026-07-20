# Status — Google sign-in and log out

**Updated:** 2026-07-20
**Branch (this repo):** `feat/google-signin-logout`
**Branch (backend):** `airtag-tracker` is on `feat/api-token-auth`

## Where we are

Design is **approved**. No implementation has started — not a single line of
feature code exists yet in either repo.

| Stage | State |
|---|---|
| Brainstorm / design | Done, approved |
| Spec written and committed | Done — `019f129` |
| Implementation plan | **Not written** — this is the next step |
| Backend implementation | Not started |
| App implementation | Not started |
| Verification on simulator | Not started |

## The design in one paragraph

Reuse the backend's existing server-side Google OAuth flow rather than adding a
second one. The app opens `/auth/google/login?native=1` in an
`expo-web-browser` auth session; the existing callback branches on a native flag
carried in the OAuth `state`, and instead of setting a cookie it redirects to
`airtaghistory://auth?code=…` with a one-time code (60s TTL, single use). The
app trades that code for a Bearer token at `POST /api/auth/exchange`. Sign-out
becomes a row inside a new account sheet, opened from a monogram avatar at the
top-right of the map, and revokes the session server-side via
`POST /api/auth/logout`.

Full detail, including rejected alternatives and their reasoning:
[`specs/2026-07-19-google-signin-and-logout-design.md`](specs/2026-07-19-google-signin-and-logout-design.md)

## Decisions already made (do not relitigate)

- **Approach:** reuse the server-side flow. The native Google Sign-In SDK and
  `expo-auth-session` PKCE were both considered and rejected — see the spec.
- **One-time code**, not the session token, in the deep link.
- **Monogram avatar**, not a Google profile photo — scope is `openid email`, so
  no picture URL exists, and adding `profile` scope isn't worth a column plus a
  migration.
- **No confirmation dialog** on sign out. Opening a sheet and tapping a red row
  is already deliberate.
- **Account sheet**, not a pushed Account screen — the app has no navigation
  stack and building one for a single row is premature.
- Email + password login **stays**. Android and Sign in with Apple are out of scope.

## Non-obvious things to carry forward

- The flow type (native vs web) must be read from the **`oauth_state` cookie we
  set**, never from the `state` echoed back in the query string — the echoed
  value is attacker-controllable, and on a CSRF failure the two don't match.
- `auth.tsx` currently fakes the restored user as `{ id: 0, email: "" }` and
  probes token validity by calling `getTags()`. The new `GET /api/auth/me`
  replaces both; delete the placeholder and the probe.
- `AGENTS.md` requires checking API signatures against
  <https://docs.expo.dev/versions/v57.0.0/> before writing Expo code, not
  writing them from memory.
- `expo-web-browser` and `expo-linking` are native modules, so adding them needs
  an `expo run:ios` rebuild.
- `app.json` already declares `"scheme": "airtaghistory"` — no config change
  needed for the deep link.
- Only one user account exists (the developer's), so there are no existing
  sessions or users to migrate.

## Next step

Write the implementation plan with the `superpowers:writing-plans` skill, then
execute it with `superpowers:executing-plans`. The plan file is what tracks
progress across sessions — this document only tracks the phase.

## Reference

- Spec: `docs/superpowers/specs/2026-07-19-google-signin-and-logout-design.md`
- OAuth flow explainer (for understanding the protocol, not the implementation):
  <https://claude.ai/code/artifact/80817fc0-5e4a-4651-906a-348b09c7b21f>
- UI options and the critique behind the account-sheet decision:
  <https://claude.ai/code/artifact/c477124e-d1a7-4de8-8c92-7c9d51478b5b>
