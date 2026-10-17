import { useCallback, useEffect, useState } from "react";
import type { JobProgress } from "@revamp-app/engine";
import { AppDetail } from "./AppDetail.tsx";
import { JobView, type JobRequest } from "./JobView.tsx";
import { badgeFor, checkFor, plain, progressLabel, type AppsList } from "./model.ts";
import type { Rpc } from "./rpc.ts";
import { Sources } from "./Sources.tsx";
import { Storage } from "./Storage.tsx";

type View = { kind: "app"; appId: string } | { kind: "sources" } | { kind: "storage" };

export function App({ rpc }: { rpc: Rpc }) {
  const [list, setList] = useState<AppsList | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState<string | null>(null);
  const [job, setJob] = useState<JobRequest | null>(null);

  const refresh = useCallback(async () => {
    const next = await rpc.call<AppsList>("apps.list");
    setList(next);
    setView((v) => v ?? (next.apps[0] ? { kind: "app", appId: next.apps[0].appId } : { kind: "sources" }));
  }, [rpc]);
  useEffect(() => void refresh().catch((e: Error) => setError(e.message)), [refresh]);
  useEffect(() => rpc.onClose((reason) => setStopped(`Revamp stopped working: ${reason}. Close and reopen the window.`)), [rpc]);

  const task = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      await refresh().catch(() => {});
    }
  };
  // The check's own log lines and download progress show in the sidebar's one-line status while it runs.
  const checkNow = () =>
    task("Checking…", async () => {
      const stop = rpc.onNotification((method, params) => {
        if (method === "job.log") setBusy((params as { line: string }).line);
        else if (method === "job.progress") setBusy(progressLabel(params as JobProgress));
      });
      try {
        await rpc.call("check.run");
      } finally {
        stop();
      }
    });

  if (stopped) return <p className="fatal">{plain(stopped)}</p>;
  if (!list || !view) return <p className="fatal">{plain(error ?? "Starting Revamp…")}</p>;
  const done = () => {
    setJob(null);
    void refresh().catch(() => {});
  };
  const selected = view.kind === "app" ? list.apps.find((a) => a.appId === view.appId) : undefined;
  // The window stays mounted (hidden) under a job, so an app's chosen version, toggles and options survive it.
  return (
    <>
      {job && <JobView rpc={rpc} request={job} onDone={done} />}
      <div className="window" hidden={job !== null}>
        <aside className="side">
          <div className="side-head">
            <span className="muted">Your apps</span>
          </div>
          {list.apps.map((a) => {
            const badge = badgeFor(a, checkFor(list, a.appId));
            return (
              <button key={a.appId} className={`nav ${view.kind === "app" && view.appId === a.appId ? "sel" : ""}`} onClick={() => setView({ kind: "app", appId: a.appId })}>
                <span className="nav-title">{plain(a.name)}</span>
                <span className="muted">{a.current ?? ""}</span>
                <span className={`pill ${badge.kind}`}>{badge.label}</span>
              </button>
            );
          })}
          {list.apps.length === 0 && <p className="muted">No apps yet. Add a source to see the apps it can patch.</p>}
          <div className="side-foot">
            <button className={`nav ${view.kind === "sources" ? "sel" : ""}`} onClick={() => setView({ kind: "sources" })}>
              <span className="nav-title">Sources</span>
            </button>
            <button className={`nav ${view.kind === "storage" ? "sel" : ""}`} onClick={() => setView({ kind: "storage" })}>
              <span className="nav-title">Storage</span>
            </button>
            <p className="muted status-line" title={busy ?? undefined}>
              {plain(busy ?? (list.lastCheck ? `Checked ${new Date(list.lastCheck.checkedAt).toLocaleString()}` : "Not checked yet"))}
            </p>
            <button className="small" disabled={busy !== null} onClick={checkNow}>
              Check now
            </button>
          </div>
        </aside>
        <main className="main">
          {error && <pre className="banner danger">{plain(error)}</pre>}
          {view.kind === "sources" && <Sources rpc={rpc} onChanged={refresh} />}
          {view.kind === "storage" && <Storage rpc={rpc} />}
          {selected && <AppDetail key={selected.appId} rpc={rpc} app={selected} check={checkFor(list, selected.appId)} onChanged={refresh} onRun={setJob} />}
        </main>
      </div>
    </>
  );
}
