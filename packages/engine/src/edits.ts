export interface Edit {
  file: string;
  start: number;
  end: number;
  text: string;
  patch: string;
  seq: number;
}

export class EditConflictError extends Error {}

/** Text splices against original file contents, each tagged with the patch that made it. */
export class EditBuffer {
  private edits: Edit[] = [];
  private seq = 0;
  /** Label of the patch whose edits are being recorded; the job runner sets it around each patch. */
  current: string | undefined;

  record(file: string, start: number, end: number, text: string): void {
    if (this.current === undefined) throw new Error("edits can only be made while a patch runs");
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      throw new Error(`invalid edit range ${start}..${end} in ${file}`);
    }
    this.edits.push({ file, start, end, text, patch: this.current, seq: this.seq++ });
  }

  /** Forgets every edit of a patch that failed or was skipped. */
  drop(patch: string): void {
    this.edits = this.edits.filter((e) => e.patch !== patch);
  }

  files(keep: ReadonlySet<string>): string[] {
    return [...new Set(this.edits.filter((e) => keep.has(e.patch)).map((e) => e.file))];
  }

  patchesFor(file: string, keep: ReadonlySet<string>): string[] {
    return [...new Set(this.edits.filter((e) => e.file === file && keep.has(e.patch)).map((e) => e.patch))];
  }

  apply(file: string, original: string, keep: ReadonlySet<string>): string {
    const mine = this.edits.filter((e) => e.file === file && keep.has(e.patch));
    for (const e of mine) {
      if (e.end > original.length) throw new Error(`an edit by "${e.patch}" is past the end of ${file}`);
    }
    const byPosition = (a: Edit, b: Edit) => a.start - b.start || a.seq - b.seq;
    const ranges = mine.filter((e) => e.end > e.start).sort(byPosition);
    const inserts = mine.filter((e) => e.end === e.start).sort(byPosition);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start < ranges[i - 1].end) throw conflict(file, ranges[i - 1], ranges[i]);
    }
    for (const ins of inserts) {
      const inside = ranges.find((r) => ins.start > r.start && ins.start < r.end);
      if (inside) throw conflict(file, inside, ins);
    }
    let out = "";
    let cursor = 0;
    let next = 0;
    const flushInserts = (upTo: number) => {
      while (next < inserts.length && inserts[next].start <= upTo) {
        out += original.slice(cursor, inserts[next].start) + inserts[next].text;
        cursor = inserts[next].start;
        next++;
      }
    };
    for (const r of ranges) {
      flushInserts(r.start);
      out += original.slice(cursor, r.start) + r.text;
      cursor = r.end;
    }
    flushInserts(original.length);
    return out + original.slice(cursor);
  }
}

function conflict(file: string, a: Edit, b: Edit): EditConflictError {
  return new EditConflictError(
    `patches "${a.patch}" and "${b.patch}" edit overlapping code in ${file} (offsets ${a.start}..${a.end} and ${b.start}..${b.end})`,
  );
}
