"use client";

/** A unified diff, coloured the way every code review tool colours one. */
export default function DiffView({ diff, className = "" }: { diff: string; className?: string }) {
  if (!diff) return <p className="p-3 text-[12px] text-ink-faint">No differences.</p>;
  return (
    <pre className={`overflow-auto font-mono text-[11.5px] leading-relaxed ${className}`}>
      {diff.split("\n").map((line, i) => {
        const tone = line.startsWith("+++") || line.startsWith("---")
          ? "text-ink-faint"
          : line.startsWith("@@")
            ? "text-arc"
            : line.startsWith("+")
              ? "bg-ok/10 text-ok"
              : line.startsWith("-")
                ? "bg-danger/10 text-danger"
                : "text-ink-dim";
        return (
          <div key={i} className={`whitespace-pre px-2 ${tone}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

/** Is this approval detail a diff, rather than a whole file or a command? */
export function looksLikeDiff(text: string | undefined): boolean {
  return Boolean(text?.startsWith("--- a/"));
}
