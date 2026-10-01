/**
 * Line diffs, for showing a change before it is approved or applied.
 *
 * Myers' algorithm, run only on the part of the two files that differs: the
 * common head and tail are trimmed first, so a one-line edit to a 2,000-line
 * component costs a handful of comparisons. A rewrite too large to diff
 * cheaply is shown as "all of it went, all of this came", which is honest and
 * still readable.
 */

export interface DiffLine {
  op: " " | "+" | "-";
  text: string;
}

/** Beyond this many edits the trace gets large; fall back to a plain replace. */
const MAX_EDITS = 1500;

function myers(a: string[], b: string[]): DiffLine[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= Math.min(max, MAX_EDITS); d++) {
    // Only the diagonals reachable so far, so memory grows with d², not with file size.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, d);
    }
  }
  return null;
}

function backtrack(a: string[], b: string[], trace: Int32Array[], depth: number): DiffLine[] {
  const out: DiffLine[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = depth; d > 0; d--) {
    const snap = trace[d];
    const at = (k: number) => snap[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      out.push({ op: " ", text: a[x - 1] });
      x--;
      y--;
    }
    if (x === prevX) out.push({ op: "+", text: b[y - 1] });
    else out.push({ op: "-", text: a[x - 1] });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    out.push({ op: " ", text: a[x - 1] });
    x--;
    y--;
  }
  return out.reverse();
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline ends the last line rather than starting an empty one.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const middle =
    myers(midA, midB) ?? [
      ...midA.map((text) => ({ op: "-" as const, text })),
      ...midB.map((text) => ({ op: "+" as const, text })),
    ];

  return [
    ...a.slice(0, head).map((text) => ({ op: " " as const, text })),
    ...middle,
    ...a.slice(a.length - tail).map((text) => ({ op: " " as const, text })),
  ];
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === "+") added++;
    else if (line.op === "-") removed++;
  }
  return { added, removed };
}

/**
 * Unified diff text, the format every developer reads at a glance and every
 * model has seen a million of.
 */
export function unifiedDiff(before: string, after: string, name = "file", context = 3, maxLines = 400): string {
  const lines = diffLines(before, after);
  if (!lines.some((l) => l.op !== " ")) return "";

  // Line numbers in the old and new file for each diff line.
  const numbered: { line: DiffLine; oldNo: number; newNo: number }[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of lines) {
    if (line.op !== "+") oldNo++;
    if (line.op !== "-") newNo++;
    numbered.push({ line, oldNo, newNo });
  }

  // Which lines a hunk shows: every change, and `context` lines either side.
  const keep = new Array<boolean>(numbered.length).fill(false);
  numbered.forEach(({ line }, i) => {
    if (line.op === " ") return;
    for (let j = Math.max(0, i - context); j <= Math.min(numbered.length - 1, i + context); j++) keep[j] = true;
  });

  const out = [`--- a/${name}`, `+++ b/${name}`];
  let i = 0;
  let shown = 0;
  while (i < numbered.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < numbered.length && keep[end + 1]) end++;
    const hunk = numbered.slice(i, end + 1);
    const oldStart = hunk.find((h) => h.line.op !== "+")?.oldNo ?? hunk[0].oldNo;
    const newStart = hunk.find((h) => h.line.op !== "-")?.newNo ?? hunk[0].newNo;
    const oldCount = hunk.filter((h) => h.line.op !== "+").length;
    const newCount = hunk.filter((h) => h.line.op !== "-").length;
    out.push(`@@ -${oldStart}${oldCount === 1 ? "" : `,${oldCount}`} +${newStart}${newCount === 1 ? "" : `,${newCount}`} @@`);
    for (const { line } of hunk) {
      if (shown++ >= maxLines) {
        out.push(`… diff truncated after ${maxLines} lines`);
        return out.join("\n");
      }
      out.push(`${line.op}${line.text}`);
    }
    i = end + 1;
  }
  return out.join("\n");
}
