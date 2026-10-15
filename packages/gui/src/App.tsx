import { useCallback, useEffect, useState } from "react";
import { AppDetail } from "./AppDetail.tsx";
import { badgeFor, checkFor, pendingUpdates, type AppsList } from "./model.ts";
import { notifyDone } from "./platform.ts";
import type { Rpc } from "./rpc.ts";
import { Sources } from "./Sources.tsx";
import { Storage } from "./Storage.tsx";

type View = { kind: "app"; appId: string } | { kind: "sources" } | { kind: "storage" };

export function App({ rpc }: { rpc: Rpc }) {
  const [list, setList] = useState<AppsList | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await rpc.call<AppsList>("apps.list");
    setList(next);
    setView((v) => v ?? (next.apps[0] ? { kind: "app", appId: next.apps[0].appId } : { kind: "sources" }));
  }, [rpc]);
  useEffect(() => void refresh().catch((e: Error) => setError(e.message)), [refresh]);

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
  const checkNow = () => task("Checking…", () => rpc.call("check.run"));
  const updateAll = () =>
    task("Updating…", async () => {
      const failed: string[] = [];
      for (const appId of pendingUpdates(list!)) {
        setBusy(`Updating ${list!.apps.find((a) => a.appId === appId)!.name}…`);
        await rpc.call("job.update", { appId }).catch((e: Error) => failed.push(`${appId}: ${e.message}`));
      }
      if (failed.length) setError(failed.join("\n"));
      await notifyDone(failed.length ? `Update all finished with ${failed.length} failed` : "Update all finished");
    });

  if (!list || !view) return <p className="fatal">{error ?? "Starting Revamp…"}</p>;
  const pending = pendingUpdates(list);
  const selected = view.kind === "app" ? list.apps.find((a) => a.appId === view.appId) : undefined;
  return (
    <div className="window">
      <aside className="side">
        <div className="side-head">
          <span className="muted">Your apps</span>
          {pending.length > 0 && (
            <button className="small" disabled={busy !== null} onClick={updateAll}>
              Update all ({pending.length})
            </button>
          )}
        </div>
        {list.apps.map((a) => {
          const badge = badgeFor(a, checkFor(list, a.appId));
          return (
            <button key={a.appId} className={`nav ${view.kind === "app" && view.appId === a.appId ? "sel" : ""}`} onClick={() => setView({ kind: "app", appId: a.appId })}>
              <span className="nav-title">{a.name}</span>
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
          <p className="muted">{busy ?? (list.lastCheck ? `Checked ${new Date(list.lastCheck.checkedAt).toLocaleString()}` : "Not checked yet")}</p>
          <button className="small" disabled={busy !== null} onClick={checkNow}>
            Check now
          </button>
        </div>
      </aside>
      <main className="main">
        {error && <pre className="banner danger">{error}</pre>}
        {view.kind === "sources" && <Sources rpc={rpc} onChanged={refresh} />}
        {view.kind === "storage" && <Storage rpc={rpc} />}
        {selected && <AppDetail key={selected.appId} rpc={rpc} app={selected} check={checkFor(list, selected.appId)} onChanged={refresh} />}
      </main>
    </div>
  );
}
