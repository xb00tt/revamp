import type { AppCheck, JobProgress, PatchAppResult, PatchResult } from "@revamp/engine";
import { useEffect, useState } from "react";
import { initialToggles, optionFlags, progressLabel, selectionFlags, type AppRow, type PatchRow, type Selection } from "./model.ts";
import { notifyDone } from "./platform.ts";
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

const failedOrSkipped = (r: PatchResult) => !r.internal && (r.status === "failed" || r.status === "skipped");

export function AppDetail({ rpc, app, check, onChanged }: { rpc: Rpc; app: AppRow; check: AppCheck | undefined; onChanged: () => Promise<void> }) {
  const [version, setVersion] = useState<string | undefined>(app.current ?? undefined);
  const [listing, setListing] = useState<Listing | null>(null);
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, Record<string, unknown>>>({});
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  async function run(dryRun: boolean) {
    if (!listing) return;
    setOutcome(null);
    setError(null);
    setProgress("Starting…");
    const stop = rpc.onNotification((method, params) => method === "job.progress" && setProgress(progressLabel(params as JobProgress)));
    try {
      const out = await rpc.call<Outcome>("job.patch", {
        appId: app.appId,
        version: listing.version,
        ...selectionFlags(listing.patches, toggles),
        options: optionFlags(listing.patches, values),
        force: untested || experimental,
        dryRun,
      });
      setOutcome(out);
      const head = out.report.split("\n")[0];
      await notifyDone(head);
      if (!dryRun) await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      stop();
      setProgress(null);
    }
  }

  const skip = (v: string | null) => rpc.call("check.skip", { appId: app.appId, version: v }).then(onChanged, (e: Error) => setError(e.message));
  const rollback = () => rpc.call("install.rollback", { appId: app.appId }).then(onChanged, (e: Error) => setError(e.message));

  if (outcome && (outcome.result.aborted || outcome.result.results.some(failedOrSkipped))) {
    return (
      <section>
        <h2>
          {app.name} {outcome.result.version}: {outcome.result.aborted ? "the job stopped" : "some patches didn't apply"}
        </h2>
        <p className="muted">{outcome.result.installed ? `Installed anyway, without the patches marked ✗ or –.` : `Nothing changed in your installed ${app.name}.`}</p>
        <pre className="report">{outcome.report}</pre>
        <div className="row-actions">
          <button className="primary" onClick={() => setOutcome(null)}>
            Back to patch selection
          </button>
          <button onClick={() => void navigator.clipboard.writeText(outcome.report)}>Copy report</button>
        </div>
        <p className="muted">Send the copied report to the bundle's author: it names the patch, the step that failed and the file.</p>
      </section>
    );
  }

  const current = app.versions.find((v) => v.version === app.current);
  const isUpdate = !!app.current && listing?.version !== app.current;
  const label = !app.current ? `Patch and install ${listing?.version ?? ""}` : isUpdate ? `Update to ${listing?.version}` : check?.status === "patches" ? `Re-patch ${app.current}` : `Patch ${listing?.version ?? ""}`;
  return (
    <section>
      <h2>{app.name} (Revamped)</h2>
      <p className="muted">
        {current ? `${current.version} · installed ${new Date(current.installedAt).toLocaleString()} · patched with ${current.bundle.name} ${current.bundle.version}` : "Not installed yet"}
      </p>
      {check?.status === "update" && (
        <div className="banner warning">
          New release: {app.name} {check.latest} is out.{" "}
          {check.listed ? `A dry run says ${check.applied}/${check.total} patches apply.` : `It isn't in your bundle yet; a dry run says ${check.applied}/${check.total} patches apply.`}
          <div className="row-actions">
            <button onClick={() => setVersion(check.latest)}>Review {check.latest}</button>
            <button onClick={() => skip(check.latest!)}>Skip {check.latest}</button>
          </div>
        </div>
      )}
      {check?.status === "skipped" && (
        <div className="banner">
          Skipped {check.latest}. You'll hear about the next release. <button className="link" onClick={() => skip(null)}>Undo</button>
        </div>
      )}
      {check?.status === "patches" && (
        <div className="banner accent">
          New patches: {check.bundle!.name} {check.bundle!.version} {check.newPatches?.length ? `adds ${check.newPatches.join(", ")} for` : "is out for"} your {app.name} {app.current}. Re-patch to use it.
          {check.bundle!.changelog && <pre className="report">{check.bundle!.changelog}</pre>}
        </div>
      )}
      {error && <pre className="banner danger">{error}</pre>}
      {listing && (
        <>
          <label className="field">
            <span className="muted">Version</span>
            <select value={listing.version} disabled={progress !== null} onChange={(e) => setVersion(e.target.value)}>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v} — {listing.app.versions[v] ? (listing.app.versions[v].experimental ? "experimental in your bundle" : "in your bundle") : "not in your bundle yet"}
                </option>
              ))}
            </select>
          </label>
          {(untested || experimental) && <p className="muted warn">{untested ? "Untested: checked only against GitHub's SHA-256." : "Experimental in your bundle."}</p>}
          <ul className="patches">
            {listing.patches
              .filter((p) => p.compatible)
              .map((p) => {
                const r = outcome?.result.results.find((x) => x.name === p.name);
                return (
                  <li key={p.name}>
                    <input type="checkbox" checked={!!toggles[p.name]} disabled={p.required || progress !== null} onChange={(e) => setToggles({ ...toggles, [p.name]: e.target.checked })} aria-label={p.name} />
                    <div>
                      <div>
                        {p.name} {p.required && <span className="pill">required</span>}
                        {check?.newPatches?.includes(p.name) && <span className="pill patches">new</span>}
                      </div>
                      <div className="muted">{p.description}</div>
                      {Object.entries(p.options).map(([key, o]) => {
                        const value = values[p.name]?.[key] ?? o.default;
                        const set = (v: unknown) => setValues({ ...values, [p.name]: { ...values[p.name], [key]: v } });
                        return (
                          <label key={key} className="option muted">
                            {o.type === "bool" ? <input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} /> : null}
                            {o.title}
                            {o.type !== "bool" && <input value={String(value ?? "")} onChange={(e) => set(o.type === "number" ? Number(e.target.value) : e.target.value)} />}
                          </label>
                        );
                      })}
                      {r && <div className={`status ${r.status}`}>{r.status === "applied" ? "✓ applied" : r.status}</div>}
                    </div>
                  </li>
                );
              })}
          </ul>
          <div className="row-actions">
            <button className="primary" disabled={progress !== null} onClick={() => run(false)}>
              {label}
            </button>
            <button disabled={progress !== null} onClick={() => run(true)}>
              Dry run
            </button>
            <span className="muted">{progress ?? (outcome ? outcome.report.split("\n")[0] : "")}</span>
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
                  {v.version} <span className="muted">· {new Date(v.installedAt).toLocaleString()} · {v.bundle.name} {v.bundle.version}{v.untested ? " · untested" : ""}</span>
                </span>
                {v.version === app.current ? <span className="pill accent">current</span> : <button onClick={rollback}>Roll back</button>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
