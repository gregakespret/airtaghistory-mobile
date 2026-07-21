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

test("strips a url fragment from the error slug", () => {
  expect(parseCallback("airtaghistory://auth?error=denied#foo")).toEqual({ error: "denied" });
});

test("an encoded # stays in the value (not treated as a fragment)", () => {
  expect(parseCallback("airtaghistory://auth?code=abc%23injected")).toEqual({
    code: "abc#injected",
  });
});

// Documented behaviour, not an accident: a repeated param takes the last value.
// This differs from URLSearchParams.get, which returns the first.
test("a repeated param takes the last value", () => {
  expect(parseCallback("airtaghistory://auth?code=a&code=b")).toEqual({ code: "b" });
});

test("an empty error falls through to code", () => {
  expect(parseCallback("airtaghistory://auth?error=&code=abc")).toEqual({ code: "abc" });
});
