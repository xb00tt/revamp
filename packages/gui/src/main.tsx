import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { connect } from "./platform.ts";
import { rpcClient } from "./rpc.ts";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
connect().then(
  (transport) =>
    root.render(
      <StrictMode>
        <App rpc={rpcClient(transport)} />
      </StrictMode>,
    ),
  (e: Error) => root.render(<p className="fatal">{e.message}</p>),
);
