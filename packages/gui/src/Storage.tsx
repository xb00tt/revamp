import type { StorageItem } from "@revamp/engine";
import { useEffect, useState } from "react";
import { formatBytes, reclaimable } from "./model.ts";
import type { Rpc } from "./rpc.ts";

const GROUPS: Array<[StorageItem["kind"], string]> = [
  ["release", "Downloaded releases"],
  ["bundle", "Bundles"],
  ["install", "Installed apps"],
];
const KEEP: Record<NonNullable<StorageItem["keep"]>, string> = { installed: "installed", pinned: "pinned", current: "current" };

export function Storage({ rpc }: { rpc: Rpc }) {
  const [items, setItems] = useState<StorageItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => rpc.call<StorageItem[]>("storage.list").then(setItems, (e: Error) => setError(e.message));
  useEffect(() => void load(), [rpc]);
  const remove = async (ids: string[]) => {
    setError(null);
    for (const id of ids) await rpc.call("storage.remove", { id }).catch((e: Error) => setError(e.message));
    await load();
  };
  if (!items) return <p className="muted">{error ?? "Measuring…"}</p>;
  const free = reclaimable(items);
  return (
    <section>
      <h2>Storage</h2>
      <p className="muted">
        {formatBytes(items.reduce((t, i) => t + i.bytes, 0))} used by Revamp · {free ? `${formatBytes(free)} can be freed` : "nothing to free"}
      </p>
      {free > 0 && (
        <button className="primary" onClick={() => remove(items.filter((i) => !i.keep).map((i) => i.id))}>
          Free {formatBytes(free)}
        </button>
      )}
      {error && <pre className="banner danger">{error}</pre>}
      {GROUPS.map(([kind, title]) => (
        <div className="card" key={kind}>
          <h3>{title}</h3>
          <ul className="versions">
            {items
              .filter((i) => i.kind === kind)
              .map((i) => (
                <li key={i.id}>
                  <span>{i.label}</span>
                  <span className="muted">{formatBytes(i.bytes)}</span>
                  {i.keep ? <span className="pill">{KEEP[i.keep]}</span> : <button onClick={() => remove([i.id])}>Remove</button>}
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="muted">
        Kept automatically: downloads of installed versions, the pinned bundle of each source, and each app's current install. A removed download is fetched again when needed; removing an older install takes away its roll back.
      </p>
    </section>
  );
}
