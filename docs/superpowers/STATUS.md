# Status — Google sign-in and log out

**Updated:** 2026-07-21
**Branch (this repo):** `feat/google-signin-logout` — PR
[airtaghistory-mobile#1](https://github.com/gregakespret/airtaghistory-mobile/pull/1)
**Branch (backend):** `airtag-tracker` on `feat/native-auth-endpoints` — PR
[airtag-tracker#59](https://github.com/gregakespret/airtag-tracker/pull/59)

> The backend work originally sat on `feat/api-token-auth`, but that branch's PR
> (#55) had already merged, leaving the six auth commits stranded past the merge
> point. They were cherry-picked onto a fresh branch off `master`; #59 is the one
> to review and merge.

## Where we are

All code for both halves is **written, committed, and pushed**. Every automated
check passes. What is left is the acceptance gate: the backend has to be
deployed before the app's browser round-trip can be walked on a simulator.

| Stage | State |
|---|---|
| Brainstorm / design | Done, approved |
| Spec written and committed | Done — `019f129` |
| Implementation plan | Done — `plans/2026-07-20-google-signin-and-logout.md` |
| Backend implementation (Tasks 1–5) | Done — in PR #59 |
| Backend deploy (Task 6) | **Not done — blocks manual verification** |
| App implementation (Tasks 7–12) | Done — in PR #1 |
| Automated checks (Task 13 step 1) | Done — backend 270 passed; app `tsc` clean, 16 Jest tests pass |
| Manual verification on simulator (Task 13 steps 2–4) | **Not done — blocked on the deploy** |

## What has to happen next

1. Review and merge **PR #59**, then deploy the backend and confirm the
   migration ran and the new endpoints answer (plan Task 6).
2. Walk the six simulator scenarios in plan Task 13 step 3, and confirm
   sign-out really revoked the session server-side (step 4).
3. Merge **PR #1** once those pass.

`expo-web-browser` is a native module, so the simulator run needs a dev-client
rebuild (`npx expo run:ios`), not just a Metro reload.

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
- `auth.tsx` used to fake the restored user as `{ id: 0, email: "" }` and probe
  token validity by calling `getTags()`. Both are gone — `GET /api/auth/me` now
  validates the token and returns the real user.
- `AGENTS.md` requires checking API signatures against
  <https://docs.expo.dev/versions/v57.0.0/> before writing Expo code, not
  writing them from memory.
- Only `expo-web-browser` was installed, not `expo-linking`:
  `openAuthSessionAsync` hands back the redirect URL directly, so `parseCallback`
  stayed a dependency-free pure function (and its tests need no native mocking).
  It is still a native module, so it needs an `expo run:ios` rebuild.
- `app.json` already declares `"scheme": "airtaghistory"` — no config change
  needed for the deep link.
- Only one user account exists (the developer's), so there are no existing
  sessions or users to migrate.

## Next step

Deploy the backend (plan Task 6), then run plan Task 13 steps 2–4. The plan
file's checkboxes are what track progress across sessions — this document only
tracks the phase.

## Reference

- Spec: `docs/superpowers/specs/2026-07-19-google-signin-and-logout-design.md`
- OAuth flow explainer (for understanding the protocol, not the implementation):
  <https://claude.ai/code/artifact/80817fc0-5e4a-4651-906a-348b09c7b21f>
- UI options and the critique behind the account-sheet decision:
  <https://claude.ai/code/artifact/c477124e-d1a7-4de8-8c92-7c9d51478b5b>
