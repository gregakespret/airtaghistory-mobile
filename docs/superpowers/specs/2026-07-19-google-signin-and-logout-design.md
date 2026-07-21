# Google sign-in and log out — design

**Date:** 2026-07-19
**Repos:** `airtaghistory-mobile` (this repo) and `airtag-tracker` (backend)
**Artifact:** https://claude.ai/code/artifact/80817fc0-5e4a-4651-906a-348b09c7b21f?via=auto_preview

## Goal

Let a user sign in to the iOS app with Google, and sign out again. Today the app
only accepts email + password, so a Google-only account cannot use it at all —
the README already flags this as a known gap. Signing out exists in code
(`auth.tsx`) but is not reachable from any screen, and it does not revoke the
session server-side.

## Background

The backend already implements Google OAuth for the website: `GET
/auth/google/login` sends the user to Google, `GET /auth/google/callback`
verifies the identity, calls `oauth.complete_login()` to resolve it to a user,
then `auth.start_session()` to mint a session and sets it as a cookie.

That session token is exactly what the app already uses as its `Authorization:
Bearer` token — `POST /api/auth/token` mints one the same way after checking a
password. So the identity and session halves are both solved; the only missing
piece is a way to hand a token to a native client at the end of the Google flow.

## Approach

Reuse the existing server-side Google flow rather than adding a second one.

The app opens the **existing** login route in an authentication browser session,
marking the flow as native. At the callback, instead of setting a cookie and
redirecting to `/`, the backend redirects to the app's custom scheme with a
one-time code. The app exchanges that code for a Bearer token.

This keeps the Google client secret on the server, reuses `GoogleOAuthProvider`
and `complete_login()` unchanged (and their existing tests), and requires **no
changes in the Google Cloud Console** — same client, same redirect URI.

### Rejected alternatives

**Native Google Sign-In SDK** (`@react-native-google-signin/google-signin`).
Better UX — the iOS system account picker, no browser chrome. Rejected because it
is the only option requiring a new Google Cloud iOS OAuth client, a reversed
client-id URL scheme, and a config plugin, *plus* a new backend endpoint that
verifies Google ID tokens. That endpoint would be a second, independent identity
trust path alongside the userinfo-based one already in `oauth.py` — significant
security surface for a fast-follow.

**`expo-auth-session` PKCE straight to Google.** The app drives OAuth itself and
posts the result to a new backend verify endpoint. Rejected as strictly dominated:
on iOS it still opens a browser, so the user-visible experience is identical to
the chosen approach, while adding an in-app OAuth state machine and the same new
backend endpoint the SDK option needs.

### Why a one-time code, not the token directly

The callback could redirect with the session token in the URL. It carries a
one-time code instead because a custom URL scheme can be claimed by any installed
app on iOS; intercepting a code that is single-use and expires in 60 seconds is
worth far less than intercepting a 14-day session token. The cost is one small
table and one endpoint.

## Backend design (`airtag-tracker`)

### 1. Native flag in the OAuth `state`

`GET /auth/google/login?native=1` sets `state = "native:" + secrets.token_urlsafe(16)`
rather than the bare token, and stores that whole string in the existing
`oauth_state` cookie.

The CSRF check is unchanged — still an exact match of the echoed `state` against
the cookie. The callback reads the flow type off the prefix. This avoids a second
cookie, whose survival through the browser session is less predictable than the
state parameter's.

### 2. Callback branches on flow type

In `GET /auth/{provider}/callback`, after `oauth.complete_login()` resolves the
user id (unchanged):

- **Web flow:** exactly as today — `start_session()`, set cookie, `303 → /`.
- **Native flow:** create a one-time code for that user id, then
  `303 → airtaghistory://auth?code=<code>`.

Failure paths (bad state, `OAuthError`, unknown provider) currently redirect to
`/login`. For a native flow they redirect to `airtaghistory://auth?error=<reason>`
instead, so the app can show a message rather than stranding the user on a web
login page inside a browser sheet.

The `error` value is a short machine-readable slug (`denied`, `provider_error`,
`bad_state`), not a raw exception string — the app maps it to copy.

**Which `state` decides the flow type.** The flow type is read from the *cookie*
we set, never from the `state` echoed back in the query string. The echoed value
is attacker-controllable, and on a CSRF failure the two do not match — so the
question "is this native?" must be answered by our own stored value. This matters
for the `bad_state` path specifically: it is the one error case where the echoed
state cannot be trusted to route the redirect, and answering from the cookie also
stops a crafted `state` from turning a web session into an app redirect.

### 3. `auth_codes` table

New table, created by an alembic migration alongside the existing ones:

| column | type | notes |
|---|---|---|
| `code` | text, primary key | `secrets.token_urlsafe(32)` |
| `user_id` | int, FK users | |
| `expires_at` | datetime | now + 60 seconds |

Single use is enforced by deleting the row on exchange, inside the same
transaction that reads it. Expired rows are purged opportunistically, matching
how `purge_expired_sessions()` already works.

An in-process dict was considered and rejected: it breaks as soon as the backend
runs more than one worker, and fails silently rather than loudly.

### 4. `POST /api/auth/exchange`

Request `{ "code": "..." }` → `200 { "token": ..., "user": {...} }`, the same
response shape as `POST /api/auth/token` so the app has one code path for both.

Consumes the code and mints the session with the existing `auth.start_session()`.
An unknown, expired, or already-used code returns `401` with a generic message —
the three cases are not distinguished to the client.

### 5. `POST /api/auth/logout`

Reads the `Authorization: Bearer` token, calls the existing `auth.end_session()`,
returns `204`. An absent or already-invalid token is also `204`: logging out of a
dead session is not an error.

### 6. `GET /api/auth/me`

Returns `{ id, email, timezone, providers: ["google"] }` for the bearer user.

`providers` requires one new db helper, `get_oauth_providers_for_user(user_id)` —
`db.py` currently only has the forward lookup (`get_oauth_account`).

This endpoint exists because the account sheet shows the real email and how the
user signed in, and because it replaces a hack described below.

### Backend tests

Added to the existing `test_oauth.py` / `test_auth.py`, using the fake provider
already built for the web flow:

- native `state` gets the `native:` prefix; web flow does not
- native callback redirects to the app scheme with a code; web callback still
  sets a cookie and redirects to `/`
- native failure paths redirect to the app scheme with an `error`
- exchange returns a working token; second use of the same code is rejected
- an expired code is rejected
- logout revokes the session (a request with that bearer token then fails)
- `me` returns the user and `["google"]` for a Google-linked account

## App design (`airtaghistory-mobile`)

### Dependencies

`expo-web-browser` and `expo-linking`, at their SDK 57 versions. Both are native
modules, so the dev client needs rebuilding with `expo run:ios` — already the
project's workflow (`react-native-maps` has the same constraint).

Per `AGENTS.md`, every API signature is to be checked against
<https://docs.expo.dev/versions/v57.0.0/> at implementation time rather than
written from memory.

`app.json` already declares `"scheme": "airtaghistory"`, so no config change is
needed for the deep link to reach the app.

### Sign-in flow

```
LoginScreen: "Continue with Google"
  → WebBrowser.openAuthSessionAsync(
        `${API_BASE_URL}/auth/google/login?native=1`,
        "airtaghistory://auth")
  → user completes Google in the system browser sheet
  → { type: "success", url: "airtaghistory://auth?code=…" }
  → parseCallback(url) → { code }
  → api.exchangeCode(code) → { token, user }
  → SecureStore.setItemAsync(TOKEN_KEY, token); setUser(user)
```

`type: "cancel"` and `type: "dismiss"` show **no** error — the user chose to back
out. Only a `?error=` in the callback produces a message.

### Identity surface

Sign-out is not a standalone control. It is one row of an account surface the app
does not have yet — and Google sign-in makes that gap worse, because after
signing in nothing on screen says *which* account you are in.

So: a circular **monogram** avatar (first letter of the email) sits at the
top-right of the map, opposite the existing clock toggle. It reads as identity
rather than as an action, so it does not compete with the time-travel controls,
which are the app's actual product. Tapping it opens a modal sheet showing the
email, how you signed in, your time zone, and a destructive **Sign out** row.

The avatar is a monogram, not a Google profile photo: the backend requests scope
`openid email` only, so no picture URL is available, and adding `profile` scope
plus a column to persist the URL is not worth it for decoration.

No confirmation dialog. Opening a sheet and tapping a red row is already a
deliberate sequence; a confirm would only be needed to protect a bare button
sitting on the map, which is the design this replaces.

Placement in the tag sheet's handle strip was considered and rejected: that strip
is the drag target of a `PanResponder` that captures on touch-down, so a tap
target inside it fights the gesture, and a control that fits there is under
Apple's 44 pt minimum. A full pushed Account screen was also rejected — the app
has no navigation stack (`App.tsx` swaps two screens by hand), and building one
for a single row is premature. The sheet upgrades into that screen later without
rework.

### Sign-out flow

`signOut()` becomes async: call `api.logout()` inside a `catch`, then clear
SecureStore, the in-memory token, and `user` **unconditionally**. Signing out
therefore works offline and never leaves the user stuck on a screen they wanted
to leave. The existing 401 auto-sign-out in `MapScreen.tsx` keeps working — that
token is already dead, so the best-effort revoke call failing is harmless.

### Fixing the placeholder user

`auth.tsx` currently restores a session by calling `getTags()` as a "cheap
validity probe" and then setting a placeholder user, `{ id: 0, email: "" }`, with
a comment noting the fields are unused. The account sheet needs the real email, so
the restore path calls `GET /api/auth/me` instead: one purpose-built request that
both validates the token and returns the real user. The placeholder and the probe
are deleted.

### Files

| File | Change |
|---|---|
| `src/deeplink.ts` (new) | Pure `parseCallback(url)` → `{ code }` \| `{ error }`, following the `timetravel.ts` pure-helper pattern |
| `src/deeplink.test.ts` (new) | Unit tests for the above |
| `src/api.ts` | `exchangeCode()`, `logout()`, `me()` |
| `src/auth.tsx` | `signInWithGoogle()`; async `signOut()` that revokes; restore via `me()` |
| `src/screens/LoginScreen.tsx` | "Continue with Google" button and divider above the existing form |
| `src/components/AccountSheet.tsx` (new) | Modal sheet: monogram, email, provider, time zone, Sign out |
| `src/screens/MapScreen.tsx` | Monogram avatar button at top-right; hosts the account sheet |

### Error handling

| Case | Behaviour |
|---|---|
| User cancels the browser sheet | Nothing; return to the login screen silently |
| Callback carries `?error=` | Inline message on the login screen |
| Exchange returns 401 | "Sign-in expired. Please try again." |
| Network failure during exchange | "Something went wrong." — matching the existing password path |
| `logout()` fails | Silent; local sign-out proceeds regardless |
| `me()` fails on launch | Treated as an invalid token: clear it and show the login screen |

### App tests

`parseCallback` is unit-tested (valid code, error slug, missing params,
malformed URL) — it is the only part of the flow that is pure. The browser
round-trip cannot be meaningfully unit-tested and is verified by hand on the
simulator.

Verification: `npm test`, `npx tsc --noEmit`, then a manual simulator run
covering sign in with Google, relaunch (session restore), and sign out.

## Out of scope

- Removing email + password login. Both paths stay.
- Android. The design is portable, but only iOS is built and tested here.
- Sign in with Apple.
- Account deletion, or any account management beyond viewing identity.
