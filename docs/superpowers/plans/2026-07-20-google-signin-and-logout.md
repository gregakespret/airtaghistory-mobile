# Google Sign-in and Log Out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user sign in to the iOS app with Google and sign out again, by reusing the backend's existing server-side Google OAuth flow.

**Architecture:** The app opens the backend's existing `/auth/google/login?native=1` in an `expo-web-browser` auth session. The backend marks the flow native inside the OAuth `state` it stores in its own `oauth_state` cookie; at the callback it mints a 60-second single-use code instead of a session cookie and redirects to `airtaghistory://auth?code=…`. The app trades that code for the same bearer session token `POST /api/auth/token` already returns. Sign-out lives in a new modal account sheet reached from a monogram avatar on the map, and revokes the session server-side.

**Tech Stack:** Backend — FastAPI, SQLAlchemy, Alembic, pytest, SQLite. App — Expo SDK 57, React Native 0.86, TypeScript, Jest (`jest-expo`), `expo-secure-store`, `expo-web-browser`.

## Global Constraints

- **Two repos.** Backend tasks (1–6) run in `~/dev/airtag-tracker` on branch `feat/api-token-auth`. App tasks (7–12) run in `~/dev/airtaghistory-mobile` on branch `feat/google-signin-logout`. Never mix a commit across repos.
- **Backend commands run from `~/dev/airtag-tracker/backend`** (that is where `conftest.py`, `alembic.ini` and the modules live).
- **Expo API signatures must be checked against <https://docs.expo.dev/versions/v57.0.0/> before writing Expo code**, per `AGENTS.md`. The two signatures this plan relies on were checked on 2026-07-20 and are quoted inline in Task 9.
- **Deep-link target:** `airtaghistory://auth`. `app.json` already declares `"scheme": "airtaghistory"` — do not change it.
- **Error slugs** carried back to the app are exactly `denied`, `provider_error`, `bad_state`. Never a raw exception string.
- **Auth-code TTL:** 60 seconds. **Code entropy:** `secrets.token_urlsafe(32)`.
- **The flow type (native vs web) is read only from the `oauth_state` cookie the backend set**, never from the `state` echoed back in the query string.
- **Email + password login stays.** Android and Sign in with Apple are out of scope.
- Backend head alembic revision is currently `0fc7aa40a906`; the new migration's `down_revision` is that value.

## Deviation from the spec (read before Task 9)

The spec's dependency list names both `expo-web-browser` and `expo-linking`. This plan installs **only `expo-web-browser`**. `WebBrowser.openAuthSessionAsync` returns the redirect URL directly in its result, so nothing in the flow needs a `Linking` listener or `Linking.parse`; `parseCallback` is written as a dependency-free pure function, which also keeps its unit tests free of native-module mocking. Everything else follows the spec as approved.

## File Structure

**Backend (`~/dev/airtag-tracker/backend`):**

| File | Responsibility |
|---|---|
| `db.py` | New `AuthCodeRow` model; `create_auth_code`, `consume_auth_code`, `purge_expired_auth_codes`, `get_oauth_providers_for_user` |
| `alembic/versions/<rev>_auth_codes_table.py` (new) | Creates the `auth_codes` table |
| `auth.py` | `AUTH_CODE_TTL`, `start_auth_code`, `consume_auth_code` — the token-minting layer, matching `start_session`/`end_session` |
| `main.py` | `native=1` on the login route; native branch + native error redirects in the callback; `POST /api/auth/exchange`; `POST /api/auth/logout`; `GET /api/auth/me` |
| `test_oauth.py` | Native state, native callback, native failure redirects |
| `test_auth.py` | exchange, logout, me |

**App (`~/dev/airtaghistory-mobile`):**

| File | Responsibility |
|---|---|
| `src/deeplink.ts` (new) | Pure `parseCallback(url)` — the only testable part of the browser round-trip |
| `src/deeplink.test.ts` (new) | Its unit tests |
| `src/api.ts` | `exchangeCode`, `logout`, `me`; 204 handling in `request` |
| `src/auth.tsx` | `signInWithGoogle`; async revoking `signOut`; restore via `me()` |
| `src/screens/LoginScreen.tsx` | "Continue with Google" button + divider |
| `src/components/AccountSheet.tsx` (new) | Modal sheet: monogram, email, provider, time zone, Sign out |
| `src/screens/MapScreen.tsx` | Monogram avatar at top-right; hosts the sheet |

---

# Backend — `~/dev/airtag-tracker`

### Task 1: `auth_codes` storage and the code-minting layer

**Files:**
- Modify: `backend/db.py` (add `AuthCodeRow` after `PasswordResetRow`; add helper functions)
- Create: `backend/alembic/versions/<generated>_auth_codes_table.py`
- Modify: `backend/auth.py` (add TTL + two functions)
- Test: `backend/test_auth.py`

**Interfaces:**
- Consumes: existing `db.Session`, `db.engine`, `db.Base`; `auth.start_session`.
- Produces:
  - `db.AuthCodeRow` (table `auth_codes`, columns `code` PK str, `user_id` int, `expires_at` datetime, `created_at` datetime)
  - `db.create_auth_code(code: str, user_id: int, expires_at: datetime) -> None`
  - `db.consume_auth_code(code: str) -> int | None`
  - `db.purge_expired_auth_codes() -> int`
  - `auth.AUTH_CODE_TTL: timedelta` (60 seconds)
  - `auth.start_auth_code(user_id: int) -> str`
  - `auth.consume_auth_code(code: str) -> int | None`

- [x] **Step 1: Write the failing tests**

Append to `backend/test_auth.py`:

```python
# ── Native one-time auth codes (app Google sign-in) ──────────────────────────

def test_auth_code_round_trips_to_its_user(fresh_db):
    user = db.create_user("code@example.com", None)
    code = auth.start_auth_code(user["id"])
    assert auth.consume_auth_code(code) == user["id"]


def test_auth_code_is_single_use(fresh_db):
    user = db.create_user("code@example.com", None)
    code = auth.start_auth_code(user["id"])
    auth.consume_auth_code(code)
    assert auth.consume_auth_code(code) is None


def test_auth_code_expires(fresh_db):
    user = db.create_user("code@example.com", None)
    db.create_auth_code("expired-code", user["id"], datetime.utcnow() - timedelta(seconds=1))
    assert auth.consume_auth_code("expired-code") is None


def test_unknown_auth_code_returns_none(fresh_db):
    assert auth.consume_auth_code("never-issued") is None


def test_auth_code_survives_a_concurrent_stampede(fresh_db):
    """Sequential single-use is not the requirement — atomic single-use is.
    Eight threads redeem one code at a barrier; exactly one may win."""
    user = db.create_user("code@example.com", None)
    code = auth.start_auth_code(user["id"])
    barrier = threading.Barrier(8)
    results = []
    lock = threading.Lock()

    def redeem():
        barrier.wait()
        got = auth.consume_auth_code(code)
        with lock:
            results.append(got)

    threads = [threading.Thread(target=redeem) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r for r in results if r is not None) == [user["id"]]


def test_purge_expired_auth_codes_removes_only_expired(fresh_db):
    user = db.create_user("code@example.com", None)
    db.create_auth_code("dead", user["id"], datetime.utcnow() - timedelta(seconds=1))
    live = auth.start_auth_code(user["id"])
    assert db.purge_expired_auth_codes() == 1
    assert auth.consume_auth_code(live) == user["id"]
```

`test_auth.py` already imports `auth`, `db`, and `datetime, timedelta` at the top — verify that with `head -20 backend/test_auth.py` and add any missing import. The stampede test needs `import threading`.

Sanity-check the stampede test before trusting it: a concurrency test that passes against a racy implementation is worthless. Once Step 3 is in, temporarily revert `consume_auth_code` to a `session.get(...)` / `session.delete(...)` pair and confirm this test FAILS, then restore the atomic version.

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_auth.py -k auth_code -v
```

Expected: FAIL — `AttributeError: module 'auth' has no attribute 'start_auth_code'`.

- [x] **Step 3: Add the model and helpers to `db.py`**

After the `PasswordResetRow` class, add:

```python
class AuthCodeRow(Base):
    """A one-time code handed to the native app at the end of the Google flow.

    Short-lived (60s) and deleted on use: a custom URL scheme can be claimed by
    any installed app, so a stolen code is worth far less than a 14-day session
    token would be.
    """

    __tablename__ = "auth_codes"
    code = Column(String, primary_key=True)           # secrets.token_urlsafe(32)
    user_id = Column(Integer, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
```

After `purge_expired_sessions`, add:

```python
# ── One-time auth codes (native app sign-in) ─────────────────────────────────

def create_auth_code(code: str, user_id: int, expires_at: datetime) -> None:
    with Session(engine) as session:
        session.add(AuthCodeRow(code=code, user_id=user_id, expires_at=expires_at))
        session.commit()


def consume_auth_code(code: str) -> int | None:
    """Return the code's user id and delete it, or None if unknown/expired.

    One atomic DELETE ... RETURNING, so SQLite's write lock is what enforces
    single use: a read-then-delete pair would let two concurrent exchanges of
    the same code both succeed. An expired code is deleted too — redeeming and
    expiring both retire it.
    """
    now = datetime.utcnow()
    with Session(engine) as session:
        row = session.execute(
            delete(AuthCodeRow)
            .where(AuthCodeRow.code == code)
            .returning(AuthCodeRow.user_id, AuthCodeRow.expires_at)
        ).first()
        session.commit()
        if row is None:
            return None
        user_id, expires_at = row
        return None if expires_at <= now else user_id


def purge_expired_auth_codes() -> int:
    now = datetime.utcnow()
    with Session(engine) as session:
        result = session.execute(
            delete(AuthCodeRow).where(AuthCodeRow.expires_at <= now)
        )
        session.commit()
        return result.rowcount or 0
```

- [x] **Step 4: Add the minting layer to `auth.py`**

Next to `SESSION_TTL`, add:

```python
# One-time codes bridge the browser OAuth callback to the native app. Kept very
# short because they travel through a custom URL scheme.
AUTH_CODE_TTL = timedelta(seconds=60)
```

After `end_session`, add:

```python
# ── One-time auth codes (native app sign-in) ─────────────────────────────────

def start_auth_code(user_id: int) -> str:
    """Create a one-time code row and return it (for the app redirect)."""
    code = secrets.token_urlsafe(32)
    db.create_auth_code(code, user_id, datetime.utcnow() + AUTH_CODE_TTL)
    return code


def consume_auth_code(code: str) -> int | None:
    """Redeem a code exactly once. None if unknown, expired, or already used."""
    return db.consume_auth_code(code)
```

- [x] **Step 5: Run the tests to verify they pass**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_auth.py -k auth_code -v
```

Expected: 5 passed.

- [x] **Step 6: Generate the migration**

```bash
cd ~/dev/airtag-tracker/backend && python -m alembic revision -m "auth_codes table"
```

Open the generated file in `alembic/versions/`. Confirm `down_revision` is `'0fc7aa40a906'` (the current head — if it is not, set it to that) and replace the body with:

```python
def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "auth_codes",
        sa.Column("code", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_auth_codes_user_id", "auth_codes", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_auth_codes_user_id", table_name="auth_codes")
    op.drop_table("auth_codes")
```

- [x] **Step 7: Verify the migration applies to a scratch database**

```bash
cd ~/dev/airtag-tracker/backend && \
  DATABASE_URL="sqlite:///$(mktemp -d)/mig.db" python -m alembic upgrade head && \
  echo MIGRATION_OK
```

Expected: alembic logs each revision and prints `MIGRATION_OK`.

- [x] **Step 8: Run the full backend suite**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest -q
```

Expected: all pass. **`test_startup_migrations.py` will fail with `table auth_codes already exists` until you update it.** Its `test_existing_db_behind_head_gets_upgraded` fakes an old schema by calling `Base.metadata.create_all()` and then dropping everything added since that revision; `AuthCodeRow` is now part of `Base`, so it needs a `DROP TABLE auth_codes` alongside the existing `password_resets` drop, plus the matching `assert _has_table("auth_codes")` after the upgrade. That fixture is fragile by design for every new model — this is keeping it in sync, not papering over a migration defect.

- [x] **Step 9: Commit**

```bash
cd ~/dev/airtag-tracker && git add backend/db.py backend/auth.py backend/test_auth.py \
  backend/test_startup_migrations.py backend/alembic/versions && \
  git commit -m "feat(auth): one-time auth codes for native sign-in"
```

---

### Task 2: `GET /api/auth/me`

**Files:**
- Modify: `backend/db.py` (add `get_oauth_providers_for_user` next to `get_oauth_account`)
- Modify: `backend/main.py` (new route after `api_auth_token`)
- Test: `backend/test_auth.py`

**Interfaces:**
- Consumes: `db.link_oauth_account`, `auth.start_session`, `require_user` (all existing).
- Produces:
  - `db.get_oauth_providers_for_user(user_id: int) -> list[str]` — sorted provider names
  - `GET /api/auth/me` → `{"id": int, "email": str, "timezone": str | None, "providers": list[str]}`

- [x] **Step 1: Write the failing tests**

Append to `backend/test_auth.py`:

```python
# ── GET /api/auth/me ─────────────────────────────────────────────────────────

def _bearer(user_id):
    return {"Authorization": f"Bearer {auth.start_session(user_id)}"}


def test_api_auth_me_returns_the_bearer_user(client):
    user = db.create_user("me@example.com", None)
    db.set_user_timezone(user["id"], "Europe/Ljubljana")
    r = client.get("/api/auth/me", headers=_bearer(user["id"]))
    assert r.status_code == 200
    assert r.json() == {
        "id": user["id"],
        "email": "me@example.com",
        "timezone": "Europe/Ljubljana",
        "providers": [],
    }


def test_api_auth_me_lists_linked_providers(client):
    user = db.create_user("g@example.com", None)
    db.link_oauth_account(user["id"], "google", "sub-1")
    r = client.get("/api/auth/me", headers=_bearer(user["id"]))
    assert r.json()["providers"] == ["google"]


def test_api_auth_me_rejects_anonymous(client):
    r = client.get("/api/auth/me", follow_redirects=False)
    assert r.status_code == 303  # AuthRedirect -> /login, as every API route does
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_auth.py -k api_auth_me -v
```

Expected: FAIL — 404 on `/api/auth/me`.

- [x] **Step 3: Add the db helper**

In `db.py`, after `link_oauth_account`:

```python
def get_oauth_providers_for_user(user_id: int) -> list[str]:
    """The provider names linked to a user ("google", ...), sorted."""
    with Session(engine) as session:
        rows = session.execute(
            select(OAuthAccountRow.provider).where(OAuthAccountRow.user_id == user_id)
        ).scalars().all()
        return sorted(rows)
```

- [x] **Step 4: Add the route**

In `main.py`, immediately after `api_auth_token`:

```python
@app.get("/api/auth/me")
def api_auth_me(user: dict = Depends(require_user)):
    """The current bearer user. The app calls this on launch to validate a
    stored token and to fill the account sheet, replacing an unauthenticated
    placeholder user and a getTags() validity probe."""
    return {
        "id": user["id"],
        "email": user["email"],
        "timezone": user.get("timezone"),
        "providers": db.get_oauth_providers_for_user(user["id"]),
    }
```

- [x] **Step 5: Run the tests to verify they pass**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_auth.py -k api_auth_me -v
```

Expected: 3 passed.

- [x] **Step 6: Commit**

```bash
cd ~/dev/airtag-tracker && git add backend/db.py backend/main.py backend/test_auth.py && \
  git commit -m "feat(api): GET /api/auth/me"
```

---

### Task 3: `POST /api/auth/exchange`

**Files:**
- Modify: `backend/main.py` (request model + route after `api_auth_me`)
- Test: `backend/test_auth.py`

**Interfaces:**
- Consumes: `auth.start_auth_code`, `auth.consume_auth_code` (Task 1).
- Produces: `POST /api/auth/exchange` with body `{"code": str}` → `200 {"token": str, "user": {"id", "email", "timezone"}}`, or `401` for unknown/expired/used codes. Same response shape as `POST /api/auth/token`.

- [x] **Step 1: Write the failing tests**

Append to `backend/test_auth.py`:

```python
# ── POST /api/auth/exchange ──────────────────────────────────────────────────

def test_exchange_returns_a_working_token(client):
    user = db.create_user("x@example.com", None)
    code = auth.start_auth_code(user["id"])
    r = client.post("/api/auth/exchange", json={"code": code})
    assert r.status_code == 200
    body = r.json()
    assert body["user"] == {"id": user["id"], "email": "x@example.com", "timezone": None}
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200


def test_exchange_rejects_a_reused_code(client):
    user = db.create_user("x@example.com", None)
    code = auth.start_auth_code(user["id"])
    client.post("/api/auth/exchange", json={"code": code})
    r = client.post("/api/auth/exchange", json={"code": code})
    assert r.status_code == 401


def test_exchange_rejects_an_expired_code(client):
    user = db.create_user("x@example.com", None)
    db.create_auth_code("stale", user["id"], datetime.utcnow() - timedelta(seconds=1))
    r = client.post("/api/auth/exchange", json={"code": "stale"})
    assert r.status_code == 401


def test_exchange_rejects_an_unknown_code(client):
    r = client.post("/api/auth/exchange", json={"code": "nope"})
    assert r.status_code == 401
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_auth.py -k exchange -v
```

Expected: FAIL — 404 on `/api/auth/exchange`.

- [x] **Step 3: Add the route**

In `main.py`, after `api_auth_me`:

```python
class _ExchangeRequest(BaseModel):
    code: str


@app.post("/api/auth/exchange")
def api_auth_exchange(body: _ExchangeRequest):
    """Trade a one-time code from the native Google callback for a bearer token.

    Unknown, expired, and already-used codes are all a flat 401: telling the
    caller which one it was only helps someone probing stolen codes.
    """
    db.purge_expired_auth_codes()
    user_id = auth.consume_auth_code(body.code)
    user = db.get_user_by_id(user_id) if user_id is not None else None
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired code.")
    token = auth.start_session(user["id"])
    return {
        "token": token,
        "user": {"id": user["id"], "email": user["email"], "timezone": user.get("timezone")},
    }
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_auth.py -k exchange -v
```

Expected: 4 passed.

- [x] **Step 5: Commit**

```bash
cd ~/dev/airtag-tracker && git add backend/main.py backend/test_auth.py && \
  git commit -m "feat(api): POST /api/auth/exchange"
```

---

### Task 4: `POST /api/auth/logout`

**Files:**
- Modify: `backend/main.py` (route after `api_auth_exchange`)
- Test: `backend/test_auth.py`

**Interfaces:**
- Consumes: `auth.end_session` (existing); `auth.bearer_token` — **rename** the existing module-private `auth._bearer_token` to `auth.bearer_token` as part of this task, since `main.py` now calls it across module boundaries. Its only existing caller is `get_current_user` in the same file; update that call too.
- Produces: `auth.bearer_token(request: Request) -> str | None` (renamed, behaviour unchanged); `POST /api/auth/logout` → `204` always. Revokes the bearer session if there is one.

Note: this route deliberately does **not** use `require_user`. Logging out of an already-dead session is not an error, and the app calls it best-effort.

- [x] **Step 1: Write the failing tests**

Append to `backend/test_auth.py`:

```python
# ── POST /api/auth/logout ────────────────────────────────────────────────────

def test_api_logout_revokes_the_session(client):
    user = db.create_user("out@example.com", None)
    token = auth.start_session(user["id"])
    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers, follow_redirects=False).status_code == 303


def test_api_logout_without_a_token_is_still_204(client):
    assert client.post("/api/auth/logout").status_code == 204


def test_api_logout_with_a_dead_token_is_still_204(client):
    r = client.post("/api/auth/logout", headers={"Authorization": "Bearer already-gone"})
    assert r.status_code == 204
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_auth.py -k api_logout -v
```

Expected: FAIL — 404 on `/api/auth/logout`.

- [x] **Step 3: Make the bearer-token helper public**

In `auth.py`, rename `_bearer_token` to `bearer_token` (definition and its docstring stay as-is) and update its single caller inside `get_current_user`:

```python
    token = request.cookies.get(SESSION_COOKIE) or bearer_token(request)
```

Confirm no other caller remains:

```bash
cd ~/dev/airtag-tracker/backend && grep -rn "_bearer_token" . --include=*.py
```

Expected: no output.

- [x] **Step 4: Add the route**

In `main.py`, after `api_auth_exchange`:

```python
@app.post("/api/auth/logout", status_code=204)
def api_auth_logout(request: Request):
    """Revoke the caller's bearer session. Always 204 — the app clears its
    local token regardless, and logging out of a dead session is not an error."""
    auth.end_session(auth.bearer_token(request))
    return Response(status_code=204)
```

- [x] **Step 5: Run the tests to verify they pass**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_auth.py -k api_logout -v
```

Expected: 3 passed.

- [x] **Step 6: Run the whole backend suite (the rename touched a shared code path)**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest -q
```

Expected: all pass.

- [x] **Step 7: Commit**

```bash
cd ~/dev/airtag-tracker && git add backend/auth.py backend/main.py backend/test_auth.py && \
  git commit -m "feat(api): POST /api/auth/logout"
```

---

### Task 5: Native flag in the OAuth `state`, and a native callback branch

**Files:**
- Modify: `backend/main.py:307-350` (the "Social login" section: `oauth_login`, `oauth_callback`)
- Test: `backend/test_oauth.py`

**Interfaces:**
- Consumes: `auth.start_auth_code` (Task 1); existing `oauth.PROVIDERS`, `oauth.complete_login`, `auth.start_session`, `_OAUTH_STATE_COOKIE`.
- Produces: no new Python symbols other than module-private `_NATIVE_STATE_PREFIX`, `APP_CALLBACK_URL`, `_native_error_redirect`. Behaviour contract:
  - `GET /auth/{provider}/login?native=1` → `oauth_state` cookie value begins `native:`
  - native callback success → `303` to `airtaghistory://auth?code=<code>`
  - native callback failure → `303` to `airtaghistory://auth?error=<denied|provider_error|bad_state>`
  - web flow (no `native=1`) → completely unchanged

- [x] **Step 1: Write the failing tests**

Append to `backend/test_oauth.py` (it already imports `parse_qs, urlparse`, `db`, `main`, `oauth`):

```python
# ── native (iOS app) flow ────────────────────────────────────────────────────

def _app_redirect(response):
    """Parse a 303 to airtaghistory://auth into its query params."""
    parsed = urlparse(response.headers["location"])
    assert f"{parsed.scheme}://{parsed.netloc}" == "airtaghistory://auth"
    return {k: v[0] for k, v in parse_qs(parsed.query).items()}


def test_native_login_marks_the_state(client, provider):
    client.get("/auth/fake/login?native=1", follow_redirects=False)
    assert client.cookies.get("oauth_state").startswith("native:")


def test_web_login_state_is_not_marked_native(client, provider):
    client.get("/auth/fake/login", follow_redirects=False)
    assert not client.cookies.get("oauth_state").startswith("native:")


def test_native_callback_redirects_to_the_app_with_a_usable_code(client, provider):
    client.get("/auth/fake/login?native=1", follow_redirects=False)
    state = client.cookies.get("oauth_state")
    r = client.get(f"/auth/fake/callback?state={state}&code=xyz", follow_redirects=False)
    assert r.status_code == 303
    code = _app_redirect(r)["code"]
    # No session cookie was set: the app gets a token by exchanging the code.
    assert "session" not in r.cookies
    exchanged = client.post("/api/auth/exchange", json={"code": code})
    assert exchanged.status_code == 200
    assert exchanged.json()["user"]["email"] == "social@example.com"


def test_native_callback_bad_state_redirects_to_the_app(client, provider):
    client.get("/auth/fake/login?native=1", follow_redirects=False)
    r = client.get("/auth/fake/callback?state=forged&code=xyz", follow_redirects=False)
    assert _app_redirect(r)["error"] == "bad_state"


def test_native_callback_provider_failure_redirects_to_the_app(client, provider, monkeypatch):
    def boom(params, redirect_uri):
        raise oauth.OAuthError("provider said no")

    monkeypatch.setattr(provider, "fetch_userinfo", boom)
    client.get("/auth/fake/login?native=1", follow_redirects=False)
    state = client.cookies.get("oauth_state")
    r = client.get(f"/auth/fake/callback?state={state}&code=xyz", follow_redirects=False)
    assert _app_redirect(r)["error"] == "provider_error"


def test_native_callback_user_denial_redirects_with_denied(client, provider, monkeypatch):
    def boom(params, redirect_uri):
        raise oauth.OAuthError("no code in callback")

    monkeypatch.setattr(provider, "fetch_userinfo", boom)
    client.get("/auth/fake/login?native=1", follow_redirects=False)
    state = client.cookies.get("oauth_state")
    r = client.get(
        f"/auth/fake/callback?state={state}&error=access_denied", follow_redirects=False
    )
    assert _app_redirect(r)["error"] == "denied"


def test_forged_native_state_cannot_redirect_a_web_flow_to_the_app(client, provider):
    """The flow type comes from our cookie, not the echoed state: a crafted
    `state=native:…` on a web session must still land on /login."""
    client.get("/auth/fake/login", follow_redirects=False)
    r = client.get("/auth/fake/callback?state=native:forged&code=xyz", follow_redirects=False)
    assert r.headers["location"] == "/login"
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_oauth.py -k native -v
```

Expected: FAIL — the `oauth_state` cookie has no `native:` prefix.

- [x] **Step 3: Rewrite the social-login section of `main.py`**

Replace the block from `_OAUTH_STATE_COOKIE = "oauth_state"` through the end of `oauth_callback` with:

```python
_OAUTH_STATE_COOKIE = "oauth_state"
# A native flow is marked inside the state we store, not in a second cookie:
# the state parameter's survival through the browser session is the one thing
# this flow already depends on.
_NATIVE_STATE_PREFIX = "native:"
# Where the iOS app's custom URL scheme picks the flow back up.
APP_CALLBACK_URL = "airtaghistory://auth"


def _oauth_redirect_uri(request: Request, provider: str) -> str:
    return f"{request.base_url}auth/{provider}/callback"


def _native_redirect(**params: str) -> RedirectResponse:
    response = RedirectResponse(f"{APP_CALLBACK_URL}?{urlencode(params)}", status_code=303)
    response.delete_cookie(_OAUTH_STATE_COOKIE)
    return response


@app.get("/auth/{provider}/login")
def oauth_login(request: Request, provider: str, native: str | None = None):
    prov = oauth.PROVIDERS.get(provider)
    if prov is None:
        raise AuthRedirect("/login")
    state = secrets.token_urlsafe(16)
    if native == "1":
        state = _NATIVE_STATE_PREFIX + state
    url = prov.authorize_url(state, _oauth_redirect_uri(request, provider))
    response = RedirectResponse(url, status_code=303)
    response.set_cookie(
        _OAUTH_STATE_COOKIE, state, max_age=600, httponly=True,
        samesite="lax", secure=auth.COOKIE_SECURE,
    )
    return response


@app.get("/auth/{provider}/callback")
def oauth_callback(request: Request, provider: str):
    # Whether this is a native flow is answered by the state WE stored, never by
    # the state echoed back: the echoed value is attacker-controllable, and on a
    # CSRF failure the two don't match at all.
    expected = request.cookies.get(_OAUTH_STATE_COOKIE)
    is_native = bool(expected) and expected.startswith(_NATIVE_STATE_PREFIX)

    def fail(reason: str):
        if is_native:
            return _native_redirect(error=reason)
        raise AuthRedirect("/login")

    prov = oauth.PROVIDERS.get(provider)
    if prov is None:
        return fail("bad_state")
    # CSRF: the state echoed back must match the one we set at login start.
    if not expected or request.query_params.get("state") != expected:
        return fail("bad_state")

    try:
        info = prov.fetch_userinfo(dict(request.query_params), _oauth_redirect_uri(request, provider))
    except oauth.OAuthError as exc:
        logger.warning("oauth %s login failed: %s", provider, exc)
        denied = request.query_params.get("error") == "access_denied"
        if is_native:
            return _native_redirect(error="denied" if denied else "provider_error")
        raise AuthRedirect("/login") from exc

    user_id = oauth.complete_login(provider, info)
    if is_native:
        return _native_redirect(code=auth.start_auth_code(user_id))

    token = auth.start_session(user_id)
    response = RedirectResponse("/", status_code=303)
    _set_session_cookie(response, token)
    response.delete_cookie(_OAUTH_STATE_COOKIE)
    return response
```

Add `urlencode` to the imports at the top of `main.py`:

```python
from urllib.parse import urlencode
```

(place it with the other stdlib imports, after `from datetime import UTC, datetime, timedelta`)

- [x] **Step 4: Run the tests to verify they pass**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest test_oauth.py -v
```

Expected: all pass — the new native tests *and* the pre-existing web-flow tests (`test_oauth_callback_creates_session`, `test_oauth_callback_rejects_bad_state`, `test_unknown_provider_redirects`, `test_oauth_callback_provider_failure_redirects_to_login`).

- [x] **Step 5: Run the whole backend suite**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest -q
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
cd ~/dev/airtag-tracker && git add backend/main.py backend/test_oauth.py && \
  git commit -m "feat(oauth): native app branch in the Google callback"
```

---

### Task 6: Deploy the backend

The app talks to `https://airtaghistory.com` (`src/config.ts`), so every app task below needs these endpoints live. This task is a gate, not code.

- [x] **Step 1: Push the backend branch**

```bash
cd ~/dev/airtag-tracker && git push -u origin feat/api-token-auth
```

- [ ] **Step 2: Deploy however this backend is normally deployed, then confirm the migration ran and the endpoints answer**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://airtaghistory.com/api/auth/logout
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -d '{"code":"nope"}' https://airtaghistory.com/api/auth/exchange
curl -s -o /dev/null -w '%{redirect_url}\n' \
  'https://airtaghistory.com/auth/google/login?native=1'
```

Expected: `204`, then `401`, then a `https://accounts.google.com/o/oauth2/v2/auth?...` URL whose `state` parameter starts with `native%3A`.

**Do not start Task 9 until this step passes.**

---

# App — `~/dev/airtaghistory-mobile`

### Task 7: `parseCallback` in `src/deeplink.ts`

**Files:**
- Create: `src/deeplink.ts`
- Test: `src/deeplink.test.ts`

**Interfaces:**
- Consumes: nothing. Deliberately dependency-free so it runs under plain Jest.
- Produces: `export type CallbackResult = { code: string } | { error: string };` and `export function parseCallback(url: string): CallbackResult`. An unparseable URL, or one with neither param, yields `{ error: "provider_error" }` — the app's generic "Something went wrong." bucket.

- [x] **Step 1: Write the failing tests**

Create `src/deeplink.test.ts`:

```typescript
import { parseCallback } from "./deeplink";

test("extracts a code", () => {
  expect(parseCallback("airtaghistory://auth?code=abc123")).toEqual({ code: "abc123" });
});

test("extracts an error slug", () => {
  expect(parseCallback("airtaghistory://auth?error=denied")).toEqual({ error: "denied" });
});

test("prefers the error when both are present", () => {
  expect(parseCallback("airtaghistory://auth?code=abc&error=bad_state")).toEqual({
    error: "bad_state",
  });
});

test("url-decodes the code", () => {
  expect(parseCallback("airtaghistory://auth?code=a%2Bb%3Dc")).toEqual({ code: "a+b=c" });
});

test("ignores unrelated params", () => {
  expect(parseCallback("airtaghistory://auth?state=xyz&code=abc")).toEqual({ code: "abc" });
});

test("no params is a generic error", () => {
  expect(parseCallback("airtaghistory://auth")).toEqual({ error: "provider_error" });
});

test("an empty code is a generic error", () => {
  expect(parseCallback("airtaghistory://auth?code=")).toEqual({ error: "provider_error" });
});

test("a malformed url is a generic error", () => {
  expect(parseCallback("not a url at all")).toEqual({ error: "provider_error" });
});

test("strips a url fragment from the code", () => {
  expect(parseCallback("airtaghistory://auth?code=abc123#foo")).toEqual({ code: "abc123" });
});

test("an error slug survives a fragment intact", () => {
  // Must stay exactly "denied" — a later task switches on the backend's slugs.
  expect(parseCallback("airtaghistory://auth?error=denied#foo")).toEqual({ error: "denied" });
});

test("an encoded #  stays inside the value", () => {
  // %23 is a literal '#' in the value, not a fragment delimiter. Pins the
  // distinction so a future "fix" cannot collapse the two.
  expect(parseCallback("airtaghistory://auth?code=abc%23injected")).toEqual({
    code: "abc#injected",
  });
});

test("a repeated param takes the last value", () => {
  // Deliberate, and different from URLSearchParams.get, which returns the first.
  expect(parseCallback("airtaghistory://auth?code=a&code=b")).toEqual({ code: "b" });
});

test("an empty error falls through to the code", () => {
  expect(parseCallback("airtaghistory://auth?error=&code=abc")).toEqual({ code: "abc" });
});
```

- [x] **Step 2: Run the tests to verify they fail**

```bash
cd ~/dev/airtaghistory-mobile && npx jest src/deeplink.test.ts
```

Expected: FAIL — `Cannot find module './deeplink'`.

- [x] **Step 3: Write the implementation**

Create `src/deeplink.ts`:

```typescript
// Parses the deep link the backend redirects to at the end of the native Google
// flow: airtaghistory://auth?code=… or ?error=…
//
// Pure and dependency-free (no expo-linking): the auth session hands us the URL
// as a string, so there is nothing here that needs a native module — which keeps
// it unit-testable, the one part of the browser round-trip that is.

export type CallbackResult = { code: string } | { error: string };

// Anything we can't make sense of maps to the app's generic error copy.
const GENERIC: CallbackResult = { error: "provider_error" };

export function parseCallback(url: string): CallbackResult {
  const q = url.indexOf("?");
  if (q === -1) return GENERIC;

  // The query ends at the first *unencoded* '#' (a URL fragment) or at the end
  // of the string. An encoded "%23" is a literal '#' inside a value and must
  // survive decoding untouched, so this only looks for the raw character.
  // Without this, a fragment lands inside the value and an error slug stops
  // matching the backend's exact `denied`/`provider_error`/`bad_state`.
  const hash = url.indexOf("#", q + 1);
  const query = hash === -1 ? url.slice(q + 1) : url.slice(q + 1, hash);

  const params = new Map<string, string>();
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const rawValue = eq === -1 ? "" : pair.slice(eq + 1);
    try {
      params.set(decodeURIComponent(rawKey), decodeURIComponent(rawValue.replace(/\+/g, " ")));
    } catch {
      return GENERIC; // malformed percent-encoding
    }
  }

  // Error wins: a callback carrying both is not a success we should act on.
  const error = params.get("error");
  if (error) return { error };
  const code = params.get("code");
  if (code) return { code };
  return GENERIC;
}
```

- [x] **Step 4: Run the tests to verify they pass**

```bash
cd ~/dev/airtaghistory-mobile && npx jest src/deeplink.test.ts
```

Expected: 8 passed.

- [x] **Step 5: Type-check**

```bash
cd ~/dev/airtaghistory-mobile && npx tsc --noEmit
```

Expected: no output.

- [x] **Step 6: Commit**

```bash
cd ~/dev/airtaghistory-mobile && git add src/deeplink.ts src/deeplink.test.ts && \
  git commit -m "feat: parse the native auth callback deep link"
```

---

### Task 8: API client methods

**Files:**
- Modify: `src/api.ts` (the `request` helper and the `api` object)

**Interfaces:**
- Consumes: `API_BASE_URL`, the existing `ApiError` and `User` types.
- Produces:
  - `api.exchangeCode(code: string): Promise<{ token: string; user: User }>`
  - `api.logout(): Promise<void>`
  - `api.me(): Promise<Me>` where `export type Me = User & { providers: string[] }`

- [x] **Step 1: Handle 204 in `request`**

`POST /api/auth/logout` returns 204 with no body, and the current `request` unconditionally calls `res.json()`. In `src/api.ts`, replace the tail of `request`:

```typescript
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  }
  // 204 has no body; callers that expect nothing back type T as void.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
```

- [x] **Step 2: Add the `Me` type and the three methods**

Under the existing `User` type declaration, add:

```typescript
export type Me = User & { providers: string[] };
```

Inside the `api` object, after `login`:

```typescript
  async exchangeCode(code: string) {
    return request<{ token: string; user: User }>("/api/auth/exchange", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
  },
  async logout() {
    return request<void>("/api/auth/logout", { method: "POST" });
  },
  me() {
    return request<Me>("/api/auth/me");
  },
```

- [x] **Step 3: Type-check and run the suite**

```bash
cd ~/dev/airtaghistory-mobile && npx tsc --noEmit && npm test
```

Expected: no tsc output; all Jest tests pass.

- [x] **Step 4: Commit**

```bash
cd ~/dev/airtaghistory-mobile && git add src/api.ts && \
  git commit -m "feat(api): exchangeCode, logout and me"
```

---

### Task 9: `signInWithGoogle`, revoking `signOut`, and a real restored user

**Files:**
- Modify: `package.json` (adds `expo-web-browser`)
- Modify: `src/auth.tsx`

**Interfaces:**
- Consumes: `api.exchangeCode`, `api.logout`, `api.me` (Task 8); `parseCallback` (Task 7).
- Produces the `AuthState` shape every screen below uses:

```typescript
type AuthState = {
  user: Me | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};
```

`signInWithGoogle` resolves silently when the user cancels, and throws `Error` with ready-to-display copy otherwise.

**Checked against <https://docs.expo.dev/versions/v57.0.0/sdk/webbrowser/> on 2026-07-20:**

```typescript
WebBrowser.openAuthSessionAsync(
  url: string,
  redirectUrl?: string | null,
  options?: AuthSessionOpenOptions
): Promise<WebBrowserAuthSessionResult>
// result is one of: { type: 'success', url: string } | { type: 'cancel' }
//                 | { type: 'dismiss' } | { type: 'opened' }  (Android only)
```

- [x] **Step 1: Install the dependency**

```bash
cd ~/dev/airtaghistory-mobile && npx expo install expo-web-browser
```

Expected: `package.json` gains `expo-web-browser` at its SDK 57 version.

- [x] **Step 2: Rewrite `src/auth.tsx`**

`expo-web-browser` is a native module, so the dev client must be rebuilt (Step 3) before this runs on a device. Replace the whole file with:

```tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { api, ApiError, Me } from "./api";
import { API_BASE_URL } from "./config";
import { parseCallback } from "./deeplink";

const TOKEN_KEY = "airtaghistory.token";
const GOOGLE_LOGIN_URL = `${API_BASE_URL}/auth/google/login?native=1`;
const REDIRECT_URL = "airtaghistory://auth";

// Backend error slugs -> copy. Anything unrecognised falls through to generic.
const ERROR_COPY: Record<string, string> = {
  denied: "Google sign-in was cancelled.",
  bad_state: "Sign-in expired. Please try again.",
  provider_error: "Something went wrong.",
};

type AuthState = {
  user: Me | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);

  const persist = async (token: string, me: Me) => {
    api.setToken(token);
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setUser(me);
  };

  // On launch, restore a saved token. /api/auth/me both validates it and returns
  // the real user, so the account sheet has an email to show.
  useEffect(() => {
    (async () => {
      try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        if (token) {
          api.setToken(token);
          try {
            setUser(await api.me());
          } catch {
            await SecureStore.deleteItemAsync(TOKEN_KEY);
            api.setToken(null);
          }
        }
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { token, user } = await api.login(email, password);
    await persist(token, { ...user, providers: [] });
  };

  const signInWithGoogle = async () => {
    const result = await WebBrowser.openAuthSessionAsync(GOOGLE_LOGIN_URL, REDIRECT_URL);
    // Backing out of the browser sheet is a choice, not an error.
    if (result.type !== "success") return;

    const parsed = parseCallback(result.url);
    if ("error" in parsed) {
      throw new Error(ERROR_COPY[parsed.error] ?? ERROR_COPY.provider_error);
    }
    try {
      const { token, user } = await api.exchangeCode(parsed.code);
      await persist(token, { ...user, providers: ["google"] });
    } catch (e) {
      throw new Error(
        e instanceof ApiError && e.status === 401
          ? "Sign-in expired. Please try again."
          : "Something went wrong.",
      );
    }
  };

  // Best-effort server-side revoke, then clear locally no matter what: signing
  // out has to work offline, and must never strand the user on a screen.
  const signOut = async () => {
    try {
      await api.logout();
    } catch {
      // already-dead token, or no network — the local clear below is what counts
    }
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
    api.setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, signIn, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
```

Note: `signOut` is now `Promise<void>`. `MapScreen.tsx:59` calls it inside a `catch` without awaiting — that still compiles and still works (the promise is simply not awaited), and Task 12 leaves that call site alone.

- [x] **Step 3: Rebuild the dev client**

```bash
cd ~/dev/airtaghistory-mobile && npx expo run:ios
```

Expected: the app builds and launches in the simulator. A native module was added, so a plain `expo start` against the old dev client would fail at `openAuthSessionAsync`.

- [x] **Step 4: Type-check and run the suite**

```bash
cd ~/dev/airtaghistory-mobile && npx tsc --noEmit && npm test
```

Expected: no tsc output; all Jest tests pass.

- [x] **Step 5: Commit**

```bash
cd ~/dev/airtaghistory-mobile && git add package.json package-lock.json src/auth.tsx ios && \
  git commit -m "feat(auth): Google sign-in, revoking sign-out, real restored user"
```

---

### Task 10: "Continue with Google" on the login screen

**Files:**
- Modify: `src/screens/LoginScreen.tsx`

**Interfaces:**
- Consumes: `signInWithGoogle` from `useAuth()` (Task 9).
- Produces: no exported symbols.

- [x] **Step 1: Wire the handler**

In `src/screens/LoginScreen.tsx`, change the `useAuth()` destructure and add a second handler:

```tsx
  const { signIn, signInWithGoogle } = useAuth();
```

```tsx
  const google = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      // signInWithGoogle throws Errors whose message is already display copy.
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
```

- [x] **Step 2: Add the button and divider above the form**

Insert between `<Text style={styles.title}>` and the first `<TextInput>`:

```tsx
      <Pressable
        style={styles.googleButton}
        onPress={google}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
      >
        <Text style={styles.googleButtonText}>Continue with Google</Text>
      </Pressable>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>
```

- [x] **Step 3: Add the styles**

Add to the `StyleSheet.create` object:

```tsx
  googleButton: {
    backgroundColor: "#fff", borderRadius: 12, padding: 16, alignItems: "center",
    borderWidth: 1, borderColor: "#ddd",
  },
  googleButtonText: { color: "#1a1a1a", fontSize: 16, fontWeight: "600" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: "#ddd" },
  dividerText: { color: "#888", fontSize: 13 },
```

- [x] **Step 4: Type-check and run the suite**

```bash
cd ~/dev/airtaghistory-mobile && npx tsc --noEmit && npm test
```

Expected: no tsc output; all Jest tests pass.

- [x] **Step 5: Commit**

```bash
cd ~/dev/airtaghistory-mobile && git add src/screens/LoginScreen.tsx && \
  git commit -m "feat(login): Continue with Google"
```

---

### Task 11: The account sheet

**Files:**
- Create: `src/components/AccountSheet.tsx`

**Interfaces:**
- Consumes: the `Me` type from `src/api`.
- Produces:

```tsx
export default function AccountSheet(props: {
  user: Me;
  visible: boolean;
  onClose: () => void;
  onSignOut: () => void;
}): React.JSX.Element
```

`onSignOut` is fired by the row; the parent decides what to do (Task 12 closes the sheet and calls `signOut`). No confirmation dialog — opening a sheet and tapping a red row is already deliberate.

- [x] **Step 1: Write the component**

Create `src/components/AccountSheet.tsx`:

```tsx
import React from "react";
import { View, Text, Pressable, StyleSheet, Modal } from "react-native";
import { Me } from "../api";

const PROVIDER_LABELS: Record<string, string> = { google: "Google" };

export function monogram(email: string): string {
  const first = email.trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}

function signedInWith(providers: string[]): string {
  if (providers.length === 0) return "Email and password";
  return providers.map((p) => PROVIDER_LABELS[p] ?? p).join(", ");
}

export default function AccountSheet({
  user,
  visible,
  onClose,
  onSignOut,
}: {
  user: Me;
  visible: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Tapping the dimmed area behind the sheet dismisses it. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close account" />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{monogram(user.email)}</Text>
          </View>
          <View style={styles.identityText}>
            <Text style={styles.email} numberOfLines={1}>{user.email}</Text>
            <Text style={styles.meta}>Signed in with {signedInWith(user.providers)}</Text>
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Time zone</Text>
          <Text style={styles.rowValue}>{user.timezone ?? "Not set"}</Text>
        </View>

        <Pressable
          style={styles.signOutRow}
          onPress={onSignOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: {
    backgroundColor: "#fff", borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 36, gap: 4,
  },
  handle: {
    alignSelf: "center", width: 36, height: 5, borderRadius: 3,
    backgroundColor: "#d8d8d8", marginBottom: 16,
  },
  identity: { flexDirection: "row", alignItems: "center", gap: 14, paddingBottom: 18 },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: "#007aff",
    alignItems: "center", justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 20, fontWeight: "700" },
  identityText: { flex: 1 },
  email: { fontSize: 17, fontWeight: "600", color: "#1a1a1a" },
  meta: { fontSize: 13, color: "#888", marginTop: 2 },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5e5",
  },
  rowLabel: { fontSize: 16, color: "#1a1a1a" },
  rowValue: { fontSize: 16, color: "#888" },
  signOutRow: {
    paddingVertical: 16, alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e5e5",
  },
  signOutText: { fontSize: 16, fontWeight: "600", color: "#ff3b30" },
});
```

- [x] **Step 2: Type-check and run the suite**

```bash
cd ~/dev/airtaghistory-mobile && npx tsc --noEmit && npm test
```

Expected: no tsc output; all Jest tests pass.

- [x] **Step 3: Commit**

```bash
cd ~/dev/airtaghistory-mobile && git add src/components/AccountSheet.tsx && \
  git commit -m "feat: account sheet with sign out"
```

---

### Task 12: The monogram avatar on the map

**Files:**
- Modify: `src/screens/MapScreen.tsx`

**Interfaces:**
- Consumes: `AccountSheet` and `monogram` (Task 11); `user` and `signOut` from `useAuth()` (Task 9).
- Produces: no exported symbols.

The avatar sits top-**right**. `TimeSlider`'s clock toggle is top-left at `top: TOP_INSET, left: 16` with `TOP_INSET = 54` on iOS, so the avatar mirrors those numbers and does not collide with it.

- [x] **Step 1: Add the imports and the top inset**

In `src/screens/MapScreen.tsx`, extend the React Native import and add the others:

```tsx
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Platform } from "react-native";
import AccountSheet, { monogram } from "../components/AccountSheet";
```

Below the `PLAY_INTERVAL_MS` constant, add:

```tsx
// No safe-area-context in this project; mirrors TimeSlider's approximation so
// the avatar and the clock toggle sit on the same line.
const TOP_INSET = Platform.OS === "ios" ? 54 : 24;
```

- [x] **Step 2: Add the state and the auth values**

Change the `useAuth()` destructure and add one piece of state:

```tsx
  const { user, signOut } = useAuth();
```

```tsx
  const [accountOpen, setAccountOpen] = useState(false);
```

- [x] **Step 3: Render the avatar and the sheet**

Inside the returned `<View style={styles.container}>`, after `<TagSheet ... />`, add:

```tsx
      {user && (
        <>
          <Pressable
            style={styles.avatar}
            onPress={() => setAccountOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Account"
          >
            <Text style={styles.avatarText}>{monogram(user.email)}</Text>
          </Pressable>
          <AccountSheet
            user={user}
            visible={accountOpen}
            onClose={() => setAccountOpen(false)}
            onSignOut={() => {
              setAccountOpen(false);
              signOut();
            }}
          />
        </>
      )}
```

- [x] **Step 4: Add the styles**

Add to `StyleSheet.create`:

```tsx
  avatar: {
    position: "absolute", top: TOP_INSET, right: 16, zIndex: 10,
    width: 38, height: 38, borderRadius: 19, backgroundColor: "#007aff",
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  avatarText: { color: "#fff", fontSize: 16, fontWeight: "700" },
```

- [x] **Step 5: Type-check and run the suite**

```bash
cd ~/dev/airtaghistory-mobile && npx tsc --noEmit && npm test
```

Expected: no tsc output; all Jest tests pass.

- [x] **Step 6: Commit**

```bash
cd ~/dev/airtaghistory-mobile && git add src/screens/MapScreen.tsx && \
  git commit -m "feat(map): account avatar opening the account sheet"
```

---

### Task 13: Manual verification and status handoff

The browser round-trip cannot be meaningfully unit-tested. This task is the acceptance gate.

**Files:**
- Modify: `docs/superpowers/STATUS.md`

- [x] **Step 1: Run every automated check in both repos**

```bash
cd ~/dev/airtag-tracker/backend && uv run pytest -q
cd ~/dev/airtaghistory-mobile && npx tsc --noEmit && npm test
```

Expected: all pass, no tsc output. Paste the actual output into the task notes — do not claim green without it.

- [x] **Step 2: Launch on the simulator**

```bash
cd ~/dev/airtaghistory-mobile && npx expo run:ios
```

- [ ] **Step 3: Walk the six scenarios and record the result of each**

| # | Do this | Expect |
|---|---|---|
| 1 | On the login screen, tap "Continue with Google" and complete Google | Browser sheet closes; the map appears; a monogram avatar is at top-right |
| 2 | Tap the avatar | Sheet slides up showing the real email, "Signed in with Google", the time zone, and a red Sign out |
| 3 | Tap Sign out | Back to the login screen |
| 4 | Sign in with Google again, then force-quit and relaunch the app | Straight to the map (session restored via `/api/auth/me`), avatar still correct |
| 5 | Tap "Continue with Google", then Cancel in the browser sheet | Back on the login screen with **no** error message |
| 6 | Sign in with email + password instead | Map appears; the avatar reads "Signed in with Email and password" |

- [ ] **Step 4: Confirm sign-out really revoked the session server-side**

After scenario 3, the token the app was holding must be dead. On the backend host:

```bash
sqlite3 airtag.db 'select count(*) from sessions;'
```

Expected: one fewer row than before the sign-out.

- [ ] **Step 5: Update `STATUS.md`**

Rewrite the status table in `docs/superpowers/STATUS.md` so every row reads Done, and replace the "Next step" section with a note that both repos are implemented and verified, naming this plan file. Keep the "Decisions already made" and "Non-obvious things to carry forward" sections.

- [ ] **Step 6: Commit**

```bash
cd ~/dev/airtaghistory-mobile && git add docs/superpowers && \
  git commit -m "docs: status after implementing Google sign-in and log out"
```

- [ ] **Step 7: Finish the branch**

Use the `superpowers:finishing-a-development-branch` skill to decide how both branches get integrated.
