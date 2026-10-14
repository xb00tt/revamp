// esbuild maps an extension's automatic JSX runtime ("react/jsx-runtime") here.
import { need } from "./registry.ts";

interface JsxRuntime {
  jsx(type: unknown, props: unknown, key?: string): unknown;
  jsxs(type: unknown, props: unknown, key?: string): unknown;
}

const runtime = () => need<JsxRuntime>("jsxRuntime");

export const jsx = (type: unknown, props: unknown, key?: string) => runtime().jsx(type, props, key);
export const jsxs = (type: unknown, props: unknown, key?: string) => runtime().jsxs(type, props, key);
/** React has used this symbol for fragments since React 16, so it is safe to create before the app loads. */
export const Fragment = Symbol.for("react.fragment");
