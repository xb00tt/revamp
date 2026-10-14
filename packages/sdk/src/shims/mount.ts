import type * as React from "react";
import { need, revamp } from "./registry.ts";

interface BoundaryProps {
  id: string;
  fallback: () => React.ReactNode;
  children?: React.ReactNode;
}

let Boundary: React.ComponentType<BoundaryProps> | undefined;

/** An error boundary built from the app's React on first use, so that it exists before React is registered. */
function boundary(react: typeof React): React.ComponentType<BoundaryProps> {
  return (Boundary ??= class RevampBoundary extends react.Component<BoundaryProps, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error: unknown) {
      console.error(`Revamp: "${this.props.id}" failed, so the stock UI is shown instead`, error);
    }
    render() {
      return this.state.failed ? this.props.fallback() : this.props.children;
    }
  });
}

/**
 * Wraps an app component. When an extension registered `revamp().mounts[id]`, that component renders instead,
 * receiving the original props plus `Original`; if it throws while rendering, the original renders.
 */
export function mount<P extends object>(id: string, Original: React.ComponentType<P>): React.FunctionComponent<P> {
  return function RevampMount(props: P) {
    const react = need<typeof React>("React");
    const Replacement = revamp().mounts[id] as React.ComponentType<P & { Original: React.ComponentType<P> }> | undefined;
    if (!Replacement) return react.createElement(Original, props);
    return react.createElement(
      boundary(react),
      { id, fallback: () => react.createElement(Original, props) },
      react.createElement(Replacement, { ...props, Original }),
    );
  };
}
