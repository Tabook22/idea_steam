import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldShowRuntimeError } from "../artifacts/idea-stream/runtime-error-filter.ts";

test("extension-only M_ID errors do not cover the app with an overlay", () => {
  assert.equal(shouldShowRuntimeError({ stack: "TypeError: Cannot read properties of undefined (reading 'M_ID')\n    at Y (chrome-extension://extension-id/executors/200.js:1:761)\n    at E (chrome-extension://extension-id/executors/200.js:1:1442)" }), false);
});

test("application errors, even with the same message or mixed extension frames, remain visible", () => {
  const appStack = "TypeError: Cannot read properties of undefined (reading 'M_ID')\n    at render (http://localhost:5173/src/App.tsx:10:5)";
  assert.equal(shouldShowRuntimeError({ stack: appStack }), true);
  assert.equal(shouldShowRuntimeError({ stack: `${appStack}\n    at Y (chrome-extension://extension-id/executors/200.js:1:761)` }), true);
  assert.equal(shouldShowRuntimeError({ stack: "Error: chrome-extension://mentioned-in-message\n    at render (http://localhost:5173/src/App.tsx:10:5)" }), true);
});

test("unknown stacks are not suppressed", () => {
  assert.equal(shouldShowRuntimeError({}), true);
  assert.equal(shouldShowRuntimeError({ stack: "Error: Unrecognized stack format" }), true);
});
