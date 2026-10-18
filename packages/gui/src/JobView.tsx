import { useEffect, useRef, useState } from "react";
import { finishJob, JOB_STEPS, jobEvent, plain, startJob, type JobLine, type JobOutcome } from "./model.ts";
import { notifyDone } from "./platform.ts";
import type { Rpc } from "./rpc.ts";

/** A patch or dry run. */
export interface JobRequest {
  title: string;
  back: string;
  dryRun: boolean;
  call: () => Promise<JobOutcome>;
}

const STEP_LABEL = { download: "Download", extract: "Extract", patch: "Patch", repack: "Repack", install: "Install" };
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const minutes = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

/** Takes over the window while the job runs, then shows how it ended. */
export function JobView({ rpc, request, onDone }: { rpc: Rpc; request: JobRequest; onDone: () => void }) {
  const [job, setJob] = useState(() => startJob(request.dryRun, Date.now()));
  const [now, setNow] = useState(Date.now());
  const started = useRef(false); // StrictMode runs effects twice in development; the job must run once
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true); // the log follows new lines unless the user scrolled up to read
  const running = !job.done;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const stop = rpc.onNotification((method, params) => setJob((s) => jobEvent(s, method, params, Date.now())));
      let outcome: JobOutcome;
      try {
        outcome = await request.call();
      } catch (e) {
        outcome = { error: (e as Error).message };
      } finally {
        stop();
      }
      setJob((s) => finishJob(s, outcome, Date.now()));
    })();
  }, [rpc, request]);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (log.current && following.current) log.current.scrollTop = log.current.scrollHeight;
  }, [job.lines.length]);
  const onScroll = () => {
    const el = log.current!;
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  useEffect(() => {
    if (!running) void notifyDone(job.summary);
  }, [running]);

  const steps = JOB_STEPS.filter((s) => !job.dryRun || (s !== "repack" && s !== "install"));
  const text = (l: JobLine) => `${clock(l.at)}  ${l.text}`;
  const copy = () => void navigator.clipboard.writeText([plain(request.title), ...job.lines.map(text)].join("\n"));
  const lastEnd = Math.max(...job.lines.map((l) => l.at), job.started);

  return (
    <div className="job">
      <header className="job-head">
        <h2>{plain(request.title)}</h2>
        <span className="muted">{minutes((running ? now : lastEnd) - job.started)}</span>
      </header>
      <div className="job-now muted">{job.done ? job.summary : `${job.percent}%`}</div>
      <div className="bar">
        <div style={{ width: `${job.done && job.ok ? 100 : job.percent}%` }} className={job.done && !job.ok ? "bad" : ""} />
      </div>
      <ol className="steps">
        {steps.map((s) => (
          <li key={s} className={job.steps[s]}>
            {job.steps[s] === "done" ? "✓" : job.steps[s] === "active" ? "●" : "○"} {STEP_LABEL[s]}
          </li>
        ))}
      </ol>
      <div className="log" ref={log} onScroll={onScroll}>
        {job.lines.map((l, i) => (
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
