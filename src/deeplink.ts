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
