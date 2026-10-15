import type { AppCheck, PatchAppResult } from "@revamp/engine";
import { useEffect, useState } from "react";
import type { JobRequest } from "./JobView.tsx";
import { initialToggles, optionFlags, plain, selectionFlags, type AppRow, type PatchRow, type Selection } from "./model.ts";
import type { Rpc } from "./rpc.ts";

interface Listing {
  app: { name: string; versions: Record<string, { experimental?: boolean }> };
  version: string;
  listed: boolean;
  bundle: { name: string; version: string };
  patches: PatchRow[];
  selection: Selection;
}

interface Outcome {
  result: PatchAppResult;
  report: string;
}

export function AppDetail({ rpc, app, check, onChanged, onRun }: { rpc: Rpc; app: AppRow; check: AppCheck | undefined; onChanged: () => Promise<void>; onRun: (job: JobRequest) => void }) {
  const [version, setVersion] = useState<string | undefined>(app.current ?? undefined);
  const [listing, setListing] = useState<Listing | null>(null);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [error, setError] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    setListing(null);
    rpc.call<Listing>("patches.list", { appId: app.appId, ...(version && { version }) }).then((l) => {
      setListing(l);
      setVersion(l.version);
      setToggles(initialToggles(l.patches, l.selection));
      setValues(l.selection.options);
    }, (e: Error) => setError(e.message));
  }, [rpc, app.appId, version]);

  const latest = check?.status === "update" || check?.status === "skipped" ? check.latest : undefined;
  const versions = listing ? [...new Set([...Object.keys(listing.app.versions), ...(latest ? [latest] : []), ...(app.current ? [app.current] : [])])] : [];
  const experimental = !!listing?.app.versions[listing.version]?.experimental;
  const untested = listing ? !listing.listed : false;

  /** The job takes over the window (JobView); the app list is refreshed when the user comes back. */
  function run(dryRun: boolean) {
    if (!listing) return;
    const params = {
      appId: app.appId,
      version: listing.version,
      ...selectionFlags(listing.patches, toggles),
      options: optionFlags(listing.patches, values),
      force: untested || experimental,
      dryRun,
    };
    onRun({
      title: dryRun ? `Dry run: ${name} ${plain(listing.version)}` : `${name}: ${label}`,
      back: `Back to ${name}`,
      runs: [{ label: app.name, dryRun, call: () => rpc.call<Outcome>("job.patch", params) }],
    });
  }

  const skip = (v: string | null) => rpc.call("check.skip", { appId: app.appId, version: v }).then(onChanged, (e: Error) => setError(e.message));
  // install.rollback switches to the newest installed version that isn't current, so only that row offers it.
  const rollbackTo = app.versions.find((v) => v.version !== app.current)?.version;
  const rollback = () => {
    setRollingBack(true);
    return rpc.call("install.rollback", { appId: app.appId }).then(onChanged, (e: Error) => setError(e.message)).finally(() => setRollingBack(false));
  };
  const name = plain(app.name);

  const current = app.versions.find((v) => v.version === app.current);
  const isUpdate = !!app.current && listing?.version !== app.current;
  const label = !app.current ? `Patch and install ${listing?.version ?? ""}` : isUpdate ? `Update to ${listing?.version}` : check?.status === "patches" ? `Re-patch ${app.current}` : `Patch ${listing?.version ?? ""}`;
  return (
    <section>
      <h2>{name} (Revamped)</h2>
      <p className="muted">
        {current ? `${plain(current.version)} · installed ${new Date(current.installedAt).toLocaleString()} · patched with ${plain(current.bundle.name)} ${plain(current.bundle.version)}` : "Not installed yet"}
      </p>
      {check?.status === "update" && (
        <div className="banner warning">
          New release: {name} {plain(check.latest)} is out.{" "}
          {plain(
            `${check.listed ? "" : check.experimental ? "It's experimental in your bundle; " : "It isn't in your bundle yet; "}${check.listed ? "A dry run" : "a dry run"} ${
              check.aborted ? `stopped: ${check.aborted}` : `says ${check.applied}/${check.total} patches apply.`
            }`,
          )}
          <div className="row-actions">
            <button onClick={() => setVersion(check.latest)}>Review {plain(check.latest)}</button>
            <button onClick={() => skip(check.latest!)}>Skip {plain(check.latest)}</button>
          </div>
        </div>
      )}
      {check?.status === "skipped" && (
        <div className="banner">
          Skipped {plain(check.latest)}. You'll hear about the next release. <button className="link" onClick={() => skip(null)}>Undo</button>
        </div>
      )}
      {check?.status === "patches" && (
        <div className="banner accent">
          New patches: {plain(check.bundle!.name)} {plain(check.bundle!.version)} {check.newPatches?.length ? `adds ${plain(check.newPatches.join(", "))} for` : "is out for"} your {name} {app.current}. Re-patch to use it.
          {check.bundle!.changelog && <pre className="report">{plain(check.bundle!.changelog)}</pre>}
        </div>
      )}
      {error && <pre className="banner danger">{plain(error)}</pre>}
      {listing && (
        <>
          <label className="field">
            <span className="muted">Version</span>
            <select value={listing.version} onChange={(e) => setVersion(e.target.value)}>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {plain(v)} — {listing.app.versions[v] ? (listing.app.versions[v].experimental ? "experimental in your bundle" : "in your bundle") : "not in your bundle yet"}
                </option>
              ))}
            </select>
          </label>
          {(untested || experimental) && <p className="muted warn">{untested ? "Untested: checked only against GitHub's SHA-256." : "Experimental in your bundle."}</p>}
          <ul className="patches">
            {listing.patches
              .filter((p) => p.compatible)
              .map((p) => {
                return (
                  <li key={p.name}>
                    <input type="checkbox" checked={!!toggles[p.name]} disabled={p.required} onChange={(e) => setToggles({ ...toggles, [p.name]: e.target.checked })} aria-label={p.name} />
                    <div>
                      <div>
                        {plain(p.name)} {p.required && <span className="pill">required</span>}
                        {check?.newPatches?.includes(p.name) && <span className="pill patches">new</span>}
                      </div>
                      <div className="muted">{plain(p.description)}</div>
                      {Object.entries(p.options).map(([key, o]) => {
                        const value = values[p.name]?.[key] ?? o.default;
                        const set = (v: unknown) => setValues({ ...values, [p.name]: { ...values[p.name], [key]: v } });
                        return (
                          <label key={key} className="option muted">
                            {o.type === "bool" ? <input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} /> : null}
                            {plain(o.title)}
                            {o.type !== "bool" && <input value={String(value ?? "")} onChange={(e) => set(o.type === "number" ? Number(e.target.value) : e.target.value)} />}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
          </ul>
          <div className="row-actions">
            <button className="primary" onClick={() => run(false)}>
              {label}
            </button>
            <button onClick={() => run(true)}>Dry run</button>
          </div>
        </>
      )}
      {app.versions.length > 0 && (
        <>
          <h3>Installed versions</h3>
          <ul className="versions">
            {app.versions.map((v) => (
              <li key={v.version}>
                <span>
                  {plain(v.version)} <span className="muted">· {new Date(v.installedAt).toLocaleString()} · {plain(v.bundle.name)} {plain(v.bundle.version)}{v.untested ? " · untested" : ""}</span>
                </span>
                {v.version === app.current ? <span className="pill accent">current</span> : v.version === rollbackTo && <button disabled={rollingBack} onClick={rollback}>Roll back</button>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
