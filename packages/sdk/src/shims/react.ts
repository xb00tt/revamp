// esbuild maps an extension's `import … from "react"` here: every call goes to the app's own React,
// so hooks share the app's renderer. Add a name here when extension code imports a new one.
import type * as React from "react";
import { need } from "./registry.ts";

const react = () => need<typeof React>("React");

export const useCallback: typeof React.useCallback = (callback, deps) => react().useCallback(callback, deps);
export const useEffect: typeof React.useEffect = (effect, deps) => react().useEffect(effect, deps);
export const useMemo: typeof React.useMemo = (factory, deps) => react().useMemo(factory, deps);
export const useRef = ((initial?: unknown) => react().useRef(initial)) as typeof React.useRef;
export const useState = ((initial?: unknown) => react().useState(initial)) as typeof React.useState;
export const createElement = ((...args: Parameters<typeof React.createElement>) => react().createElement(...args)) as typeof React.createElement;
