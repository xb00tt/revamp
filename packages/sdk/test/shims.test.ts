import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mount } from "../src/shims/mount.ts";
import { useState } from "../src/shims/react.ts";
import { need, revamp } from "../src/shims/registry.ts";

// React 18.3.1, the version Hydra 4.1.6 ships, standing in for the app's own React.
const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
const { act, create } = require("react-test-renderer") as {
  act(fn: () => void): void;
  create(element: unknown): { toJSON(): unknown };
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = (element: unknown) => {
  let renderer: { toJSON(): unknown } | undefined;
  act(() => {
    renderer = create(element);
  });
  return renderer!.toJSON();
};
const reset = () => {
  delete (globalThis as { __revamp?: unknown }).__revamp;
};

test("need() returns a registry entry and names a missing one", () => {
  reset();
  revamp().registry.answer = 42;
  assert.equal(need("answer"), 42);
  assert.throws(() => need("React"), /Revamp: "React" is missing from the app registry/);
});

test("the react shim calls the registered React, so hooks work inside the app's renderer", () => {
  reset();
  revamp().registry.React = React;
  function Counter() {
    const [count] = useState(7);
    return React.createElement("span", null, count);
  }
  assert.deepEqual(render(React.createElement(Counter)), { type: "span", props: {}, children: ["7"] });
});

test("mount() renders the original until an extension registers a replacement", () => {
  reset();
  revamp().registry.React = React;
  const Original = (props: { name: string }) => React.createElement("b", null, `stock ${props.name}`);
  const Mounted = mount("demo", Original);
  assert.deepEqual(render(React.createElement(Mounted, { name: "x" })), { type: "b", props: {}, children: ["stock x"] });
  revamp().mounts.demo = (props: { name: string; Original: unknown }) =>
    React.createElement("i", null, `revamped ${props.name}`, props.Original === Original ? " (has Original)" : "");
  assert.deepEqual(render(React.createElement(Mounted, { name: "x" })), {
    type: "i",
    props: {},
    children: ["revamped x", " (has Original)"],
  });
});

test("mount() falls back to the original when the replacement throws, and says why", (t) => {
  reset();
  revamp().registry.React = React;
  const errors = t.mock.method(console, "error", () => {});
  revamp().mounts.demo = () => {
    throw new Error("boom");
  };
  const Mounted = mount("demo", () => React.createElement("b", null, "stock"));
  assert.deepEqual(render(React.createElement(Mounted)), { type: "b", props: {}, children: ["stock"] });
  assert.ok(errors.mock.calls.some((c) => String(c.arguments[0]).includes('Revamp: "demo" failed, so the stock UI is shown instead')));
});
