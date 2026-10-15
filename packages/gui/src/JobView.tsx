import { useEffect, useRef, useState } from "react";
import { finishJob, JOB_STEPS, jobEvent, startJob, type JobLine, type JobOutcome, type JobState } from "./model.ts";
import { notifyDone } from "./platform.ts";
import type { Rpc } from "./rpc.ts";

/** One job of a request: a patch or dry run, or one app of "Update all". */
export interface JobRun {
  label: string;
  dryRun: boolean;
  call: () => Promise<JobOutcome>;
}

export interface JobRequest {
  title: string;
  back: string;
  runs: JobRun[];
}

const STEP_LABEL = { download: "Download", extract: "Extract", patch: "Patch", repack: "Repack", install: "Install" };
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const minutes = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** Takes over the window while a request's jobs run, one after another, then shows how each ended. */
export function JobView({ rpc, request, onDone }: { rpc: Rpc; request: JobRequest; onDone: () => void }) {
  const [jobs, setJobs] = useState<Array<{ label: string; state: JobState }>>([]);
  const [now, setNow] = useState(Date.now());
  const started = useRef(false); // StrictMode runs effects twice in development; the jobs must run once
  const log = useRef<HTMLDivElement>(null);
  const running = jobs.length < request.runs.length || jobs.some((j) => !j.state.done);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      for (const [i, run] of request.runs.entries()) {
        const update = (f: (s: JobState) => JobState) => setJobs((all) => all.map((j, k) => (k === i ? { ...j, state: f(j.state) } : j)));
        setJobs((all) => [...all, { label: run.label, state: startJob(run.dryRun, Date.now()) }]);
        const stop = rpc.onNotification((method, params) => update((s) => jobEvent(s, method, params, Date.now())));
        const outcome = await run.call().catch((e: Error) => ({ error: e.message }));
        stop();
        update((s) => finishJob(s, outcome, Date.now()));
      }
    })();
  }, [rpc, request]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const lines = jobs.flatMap((j) => (request.runs.length > 1 ? [{ at: j.state.started, kind: "info" as const, text: `── ${j.label} ──` }, ...j.state.lines] : j.state.lines));
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    if (running || jobs.length === 0) return;
    const bad = jobs.filter((j) => !j.state.ok).length;
    void notifyDone(jobs.length === 1 ? jobs[0].state.summary : bad ? `${request.title}: ${bad} of ${jobs.length} had problems` : `${request.title}: done`);
  }, [running]);

  const current = jobs.at(-1)?.state;
  const steps = JOB_STEPS.filter((s) => !current?.dryRun || (s !== "repack" && s !== "install"));
  const text = (l: JobLine) => `${clock(l.at)}  ${l.text}`;
  const copy = () => void navigator.clipboard.writeText([request.title, ...lines.map(text)].join("\n"));
  const firstStart = jobs[0]?.state.started ?? now;
  const lastEnd = Math.max(...jobs.flatMap((j) => j.state.lines.map((l) => l.at)), firstStart);

  return (
    <div className="job">
      <header className="job-head">
        <h2>{request.title}</h2>
        <span className="muted">{minutes((running ? now : lastEnd) - firstStart)}</span>
      </header>
      <div className="job-now muted">{current ? `${jobs.length > 1 || request.runs.length > 1 ? `${jobs.at(-1)!.label}: ` : ""}${current.done ? current.summary : `${current.percent}%`}` : "Starting…"}</div>
      <div className="bar">
        <div style={{ width: `${current?.done && current.ok ? 100 : (current?.percent ?? 0)}%` }} className={current?.done && !current.ok ? "bad" : ""} />
      </div>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s} className={current?.steps[s] ?? "todo"}>
            {current?.steps[s] === "done" ? "✓" : current?.steps[s] === "active" ? "●" : "○"} {STEP_LABEL[s]}
          </li>
        ))}
      </ol>
      <div className="log" ref={log}>
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.kind}`}>
            <span className="at">{clock(l.at)}</span> {l.text}
          </div>
        ))}
      </div>
      <footer className="job-foot">
        {running ? (
          <span className="muted">Keep Revamp open until this finishes.</span>
        ) : (
          <>
            <button className="primary" onClick={onDone}>
              {request.back}
            </button>
            <button onClick={copy}>Copy log</button>
          </>
        )}
      </footer>
    </div>
  );
}
