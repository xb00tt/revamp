import type { BundleSource } from "@revamp-app/engine";
import { useEffect, useState } from "react";
import { plain } from "./model.ts";
import type { Rpc } from "./rpc.ts";

interface Preview {
  token: string;
  source: BundleSource;
  manifest: { name: string; version: string; author: string; license: string };
  apps: Array<{ id: string; name: string; versions: string[] }>;
  changelog: string;
}

export function Sources({ rpc, onChanged }: { rpc: Rpc; onChanged: () => Promise<void> }) {
  const [sources, setSources] = useState<BundleSource[]>([]);
  const [location, setLocation] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const load = () => rpc.call<BundleSource[]>("sources.list").then(setSources);
  useEffect(() => void load(), [rpc]);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (e) {
      setMessage({ error: true, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const fetchPreview = () => {
    if (!location.trim()) return setMessage({ error: true, text: "Enter a source first." });
    return act(async () => setPreview(await rpc.call<Preview>("sources.prepare", { location: location.trim() })));
  };
  const trust = () =>
    act(async () => {
      await rpc.call("sources.add", { token: preview!.token });
      setPreview(null);
      setLocation("");
      await load();
      await onChanged();
    });
  const remove = (loc: string) =>
    act(async () => {
      await rpc.call("sources.remove", { location: loc });
      setRemoving(null);
      await load();
      await onChanged();
    });
  const refresh = () =>
    act(async () => {
      const lines = await rpc.call<string[]>("sources.refresh");
      setMessage({ error: false, text: lines.length ? lines.join("\n") : "Every GitHub source is on its newest version." });
      await load();
      await onChanged();
    });
  const overlap = preview ? preview.apps.filter((a) => sources.some((s) => s.apps.includes(a.id))) : [];

  return (
    <section>
      <h2>Sources</h2>
      <p className="muted">Where patch bundles come from. Each is pinned to the SHA-256 you trusted; the first source added wins for an app.</p>
      <div className="card">
        <h3>Add a source</h3>
        <div className="row-actions">
          <input value={location} placeholder="owner/repo" onChange={(e) => (setLocation(e.target.value), setMessage(null))} onKeyDown={(e) => e.key === "Enter" && fetchPreview()} />
          <button disabled={busy} onClick={fetchPreview}>
            Fetch
          </button>
        </div>
        <p className="muted">A GitHub repo, the https URL of a bundle.json, or a .mjs file.</p>
        {preview && (
          <div className="preview">
            <div>
              {plain(preview.manifest.name)} {plain(preview.manifest.version)} by {plain(preview.manifest.author)} <span className="muted">({plain(preview.manifest.license)})</span>
            </div>
            <div className="muted">Apps: {plain(preview.apps.map((a) => `${a.name} ${a.versions.join(", ")}`).join("; "))}</div>
            <div className="muted">SHA-256 to pin</div>
            <code className="hash">{preview.source.sha256}</code>
            {preview.changelog && <pre className="report">{plain(preview.changelog)}</pre>}
            {overlap.length > 0 && (
              <p className="muted warn">
                {plain(overlap.map((a) => a.name).join(", "))} already come{overlap.length === 1 ? "s" : ""} from another source. The first source added wins, so this one adds nothing for{" "}
                {overlap.length === 1 ? "it" : "them"} while that source stays.
              </p>
            )}
            <p className="muted">Bundles run sandboxed, but they decide what changes in your apps. Add only sources you trust.</p>
            <div className="row-actions">
              <button className="primary" disabled={busy} onClick={trust}>
                Trust and add
              </button>
              <button onClick={() => setPreview(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {message && <pre className={`banner ${message.error ? "danger" : ""}`}>{plain(message.text)}</pre>}
      {sources.map((s, i) => (
        <div className="card" key={s.location}>
          <h3>
            {s.location} <span className="pill">{s.kind}</span> {i === 0 && <span className="pill accent">first</span>}
          </h3>
          <p className="muted">
            {plain(s.name)} {plain(s.version)} · apps: {plain(s.apps.join(", "))}
          </p>
          <div className="muted">Pinned SHA-256</div>
          <code className="hash">{s.sha256}</code>
          <p className="muted">{s.kind === "github" ? "Moves to new versions published in the repo." : "Stays on this exact hash."}</p>
          {removing === s.location ? (
            <div className="banner danger">
              Remove {s.location}? Apps that come only from it will need another source before you can patch or update them.
              <div className="row-actions">
                <button disabled={busy} onClick={() => remove(s.location)}>
                  Remove
                </button>
                <button onClick={() => setRemoving(null)}>Keep</button>
              </div>
            </div>
          ) : (
            <div className="row-actions">
              {s.kind === "github" && (
                <button disabled={busy} onClick={refresh}>
                  Check for a new version
                </button>
              )}
              <button onClick={() => setRemoving(s.location)}>Remove</button>
            </div>
          )}
        </div>
      ))}
      {sources.length === 0 && (
        <div className="card">
          <h3>Add your first source</h3>
          <p className="muted">Add xb00tt/revamp-patches, the official patches for Hydra and Heroic.</p>
        </div>
      )}
    </section>
  );
}
