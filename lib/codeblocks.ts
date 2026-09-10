import type { Artifact, Message } from "@/lib/types";

/** Languages the preview iframe can actually run. */
const PREVIEWABLE = new Set(["html", "htm", "css", "js", "javascript", "svg"]);

const EXTENSIONS: Record<string, string> = {
  html: "html", htm: "html", css: "css", js: "js", javascript: "js",
  jsx: "jsx", ts: "ts", typescript: "ts", tsx: "tsx", python: "py", py: "py",
  json: "json", bash: "sh", sh: "sh", shell: "sh", sql: "sql", go: "go",
  rust: "rs", rs: "rs", java: "java", c: "c", cpp: "cpp", yaml: "yml",
  yml: "yml", md: "md", markdown: "md", svg: "svg",
};

/**
 * Filename on the first line of a block, as a comment. Covers the three
 * comment styles the persona prompt asks for.
 */
const FILENAME_PATTERNS = [
  /^\s*\/\/\s*([\w.-]+\.[A-Za-z0-9]+)\s*$/,
  /^\s*#\s*([\w.-]+\.[A-Za-z0-9]+)\s*$/,
  /^\s*<!--\s*([\w.-]+\.[A-Za-z0-9]+)\s*-->\s*$/,
  /^\s*\/\*\s*([\w.-]+\.[A-Za-z0-9]+)\s*\*\/\s*$/,
];

function detectFilename(code: string): string | null {
  const firstLine = code.split("\n", 1)[0] ?? "";
  for (const pattern of FILENAME_PATTERNS) {
    const match = firstLine.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Pull fenced code blocks out of markdown.
 *
 * Tracks the exact fence length so a block containing a shorter fence (a
 * ```` ```` ```` wrapper around a ``` example) doesn't terminate early.
 */
export function extractCodeBlocks(markdown: string): { lang: string; code: string }[] {
  const blocks: { lang: string; code: string }[] = [];
  const lines = markdown.split("\n");

  let fence: string | null = null;
  let lang = "";
  let buffer: string[] = [];

  for (const line of lines) {
    const open = line.match(/^\s*(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)\s*$/);

    if (fence === null) {
      if (open) {
        fence = open[1];
        lang = (open[2] || "text").toLowerCase();
        buffer = [];
      }
      continue;
    }

    // Closing fence must be the same character and at least as long.
    const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
    if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
      const code = buffer.join("\n").trim();
      if (code) blocks.push({ lang, code });
      fence = null;
      continue;
    }

    buffer.push(line);
  }

  // Unterminated fence — still mid-stream. Show what we have so far.
  if (fence !== null) {
    const code = buffer.join("\n").trim();
    if (code) blocks.push({ lang, code });
  }

  return blocks;
}

/** Every code block in a message, as canvas artifacts. */
export function artifactsFromMessage(message: Message): Artifact[] {
  return extractCodeBlocks(message.content).map((block, index) => {
    const ext = EXTENSIONS[block.lang] ?? "txt";
    return {
      id: `${message.id}-${index}`,
      lang: block.lang,
      filename: detectFilename(block.code) ?? `snippet-${index + 1}.${ext}`,
      code: block.code,
      messageId: message.id,
      previewable: PREVIEWABLE.has(block.lang),
    };
  });
}

/** Every artifact in a conversation, oldest first. */
export function artifactsFromMessages(messages: Message[]): Artifact[] {
  return messages
    .filter((m) => m.role === "assistant")
    .flatMap(artifactsFromMessage);
}

/**
 * Build the document for the preview iframe. A bare CSS or JS block gets a
 * minimal page wrapped around it so it has something to act on.
 */
export function buildPreviewDocument(artifact: Artifact): string {
  const { lang, code } = artifact;

  if (lang === "html" || lang === "htm") {
    // A fragment (no <html>) still renders, browsers are forgiving here.
    return code;
  }

  if (lang === "svg") {
    return `<!doctype html><meta charset="utf-8">
<style>html,body{height:100%;margin:0;display:grid;place-items:center;background:#0b0e14}</style>
${code}`;
  }

  if (lang === "css") {
    return `<!doctype html><meta charset="utf-8">
<style>${code}</style>
<body>
  <h1>Heading</h1>
  <p>Preview scaffold — your CSS is applied to this sample markup.</p>
  <button>Button</button>
  <div class="box">.box</div>
</body>`;
  }

  // js / javascript
  return `<!doctype html><meta charset="utf-8">
<style>body{font:14px ui-monospace,monospace;background:#0b0e14;color:#d6deeb;padding:12px}</style>
<body>
<div id="app"></div>
<div id="__log"></div>
<script>
  // Mirror console output into the page so the preview is useful on its own.
  (function () {
    var out = document.getElementById("__log");
    ["log", "warn", "error"].forEach(function (level) {
      var original = console[level];
      console[level] = function () {
        var line = document.createElement("div");
        line.textContent = Array.prototype.map.call(arguments, function (a) {
          try { return typeof a === "string" ? a : JSON.stringify(a); }
          catch (e) { return String(a); }
        }).join(" ");
        if (level === "error") line.style.color = "#ff6b6b";
        if (level === "warn") line.style.color = "#ffd166";
        out.appendChild(line);
        original.apply(console, arguments);
      };
    });
    window.onerror = function (message) { console.error("Error: " + message); };
  })();
</script>
<script>
${code}
</script>
</body>`;
}
