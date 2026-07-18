# airtaghistory-mobile

A native iOS app for [airtaghistory.com](https://airtaghistory.com) — a cleaner
on-phone UX for the AirTag history service. It shows your registered tags on an
Apple Maps view and lets you **time-travel**: scrub a slider back through history
and watch each tag's pin move to where it was at that moment.

The app is a **read-only client** over the JSON API the Railway backend already
exposes. It never touches your Apple ID — all Apple-data collection happens
server-side. The only thing the app needs from the backend is a login token.

> **Design doc:** the full spec lives in the backend repo at
> [`docs/ios-app/DESIGN.md`](https://github.com/gregakespret/airtag-tracker/blob/master/docs/ios-app/DESIGN.md).

---

## Stack

- **Expo** (SDK 57) + **React Native** + **TypeScript**
- **react-native-maps** using the native **Apple Maps** provider (no API key)
- **expo-secure-store** — the session token is kept in the iOS keychain
- **@react-native-community/slider** — the time-travel control
- **Jest** (`jest-expo` preset) for unit tests

### Why a native build (not Expo Go)

`react-native-maps` is a native module that is **not** bundled in the Expo Go
container, so this app can't run in Expo Go — the map screen would crash. We use
the **dev-client** workflow instead: `expo run:ios` compiles a real native build
of the app (via Xcode) with the native modules linked in. First build takes a
few minutes; after that, JavaScript changes hot-reload just like Expo Go.

---

## Prerequisites

- **macOS** with **Xcode** installed (open it once to accept the license and let
  it install an iOS Simulator runtime).
- **Node.js 20+** and npm.
- No Apple Developer Program membership is needed to run on the **Simulator**.
  It's only required later for TestFlight / physical-device distribution.

---

## Setup

```bash
git clone https://github.com/gregakespret/airtaghistory-mobile.git
cd airtaghistory-mobile
npm install
```

---

## Run (iOS Simulator)

```bash
npm run ios        # = expo run:ios
```

This prebuilds the native `ios/` project (if needed), compiles it with Xcode,
boots the Simulator, and launches the app. **The first build takes a few
minutes**; subsequent launches are fast.

Once the app is up:

1. Log in with your **airtaghistory.com email + password**.
   - Google-only accounts must set a password on the website first — the app's
     token endpoint requires one (Google sign-in in the app is a planned
     fast-follow).
2. You'll see your tags as pins on the map. Tap a pin for last-seen details.
3. Open the tag sheet and drag the **time slider** to scrub through history;
   tap **⚡ Live** to snap back to the present.

### Talking to a local backend

By default the app points at production:

```ts
// src/config.ts
export const API_BASE_URL = "https://airtaghistory.com";
```

To test against a backend running on your machine, change this to your host's
LAN IP (not `localhost` — the Simulator resolves that to itself), e.g.
`http://192.168.1.20:8000`, and don't commit the change.

---

## Test

```bash
npm test           # Jest — pure time-travel logic (buildTimeline / positionsAt / trailFor)
npx tsc --noEmit   # TypeScript type check
```

---

## Project layout

```
App.tsx                     App root: gates on auth state → Login or Map
index.ts                    Expo entry point
src/
  config.ts                 API base URL
  api.ts                    The single backend seam — typed client, Bearer auth,
                            centralized error handling (ApiError carries .status)
  auth.tsx                  AuthProvider / useAuth — token storage (SecureStore) + gate
  timetravel.ts             Pure helpers: buildTimeline, positionsAt, trailFor
  timetravel.test.ts        Unit tests for the above
  screens/
    LoginScreen.tsx         Email/password login
    MapScreen.tsx           Apple Maps, pins, callouts; hosts the sheet + slider,
                            drives historical pins and trails
  components/
    TagSheet.tsx            Bottom sheet listing tags with freshness dots
    TimeSlider.tsx          The time-travel slider + Live button
```

**Backend contract.** The app depends on three endpoints:

- `POST /api/auth/token` — `{ email, password }` → `{ token, user }`
- `GET /api/tags` — latest position per tag
- `GET /api/snapshots` — snapshot history (drives the timeline)

The returned `token` is an opaque server-side session token (14-day TTL, instant
revocation). The app stores it in the keychain and sends it as
`Authorization: Bearer <token>` on every request.

---

## Distribution (TestFlight) — later

Not set up yet. When enrolling in the Apple Developer Program ($99/yr):

1. `npx expo prebuild --clean` — regenerate `ios/` with the real bundle id
   (`com.gregakespret.airtaghistory`).
2. Add `eas.json`, then `eas build --platform ios --profile production`.
3. `eas submit --platform ios --latest`.

See the backend repo's `docs/ios-app/PLAN.md` (Task B6) for the full runbook.
