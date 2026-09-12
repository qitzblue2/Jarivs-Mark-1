/**
 * Containment tests for computer access.
 *
 * Separate file because these must run with JARVIS_WORKSPACE pointed at a
 * scratch directory, set before the module under test is imported.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = "/tmp/jarvis-ws-test";
process.env.JARVIS_WORKSPACE = ROOT;

const { resolveInWorkspace, scrubbedEnv, computerAccessEnabled } = await import(
  "../lib/tools/fs/workspace"
);

let pass = 0;
let fail = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const refuses = async (name: string, input: string) => {
  try {
    const resolved = await resolveInWorkspace(input);
    fail++;
    console.log(`FAIL ${name}\n     allowed: ${resolved}`);
  } catch {
    pass++;
    console.log(`ok   ${name}`);
  }
};
const allows = async (name: string, input: string) => {
  try {
    await resolveInWorkspace(input);
    pass++;
    console.log(`ok   ${name}`);
  } catch (err) {
    fail++;
    console.log(`FAIL ${name}\n     refused: ${(err as Error).message}`);
  }
};

// Fixtures: a real symlink escape and a prefix-colliding sibling directory.
await fs.rm(ROOT, { recursive: true, force: true });
await fs.mkdir(path.join(ROOT, "sub"), { recursive: true });
await fs.writeFile(path.join(ROOT, "sub", "ok.txt"), "fine");
await fs.writeFile("/tmp/jarvis-ws-secret.txt", "must never be read");
await fs.symlink("/tmp/jarvis-ws-secret.txt", path.join(ROOT, "escape.txt")).catch(() => {});
await fs.symlink("/etc", path.join(ROOT, "etc-link")).catch(() => {});
await fs.mkdir("/tmp/jarvis-ws-testX", { recursive: true });

console.log("--- paths that must be refused ---");
// The model picks these, so each one is hostile input.
await refuses("../ traversal", "../jarvis-ws-secret.txt");
await refuses("traversal through a subdirectory", "sub/../../jarvis-ws-secret.txt");
await refuses("absolute path to /etc", "/etc/passwd");
await refuses("absolute path elsewhere in /tmp", "/tmp/jarvis-ws-secret.txt");
// A prefix check alone would wave these two through.
await refuses("symlink inside pointing outside", "escape.txt");
await refuses("file via a symlinked directory", "etc-link/passwd");
await refuses("sibling dir sharing the root's prefix", "../jarvis-ws-testX/f.txt");
await refuses("null byte in path", "sub/ok.txt\0.png");
await refuses("empty path", "");

console.log("--- paths that must be allowed ---");
await allows("existing nested file", "sub/ok.txt");
await allows("a file that doesn't exist yet", "sub/brand-new.txt");
await allows("the workspace root", ".");
await allows("absolute path that is inside", path.join(ROOT, "sub", "ok.txt"));

// No tilde expansion: "~" is a literal directory name, never the real home.
const tilde = await resolveInWorkspace("~/.ssh/id_rsa");
eq("~ never resolves to the real home", tilde.startsWith(ROOT), true);

console.log("\n--- environment scrubbing ---");
// A command that can read the API keys is worse than one that reads a file.
process.env.GROQ_API_KEY = "gsk_should_not_leak";
process.env.TAVILY_API_KEY = "tvly_should_not_leak";
process.env.JARVIS_PASSWORD = "should_not_leak_either";
const env = scrubbedEnv();
for (const name of [
  "GROQ_API_KEY", "CEREBRAS_API_KEY", "TAVILY_API_KEY", "GITHUB_TOKEN",
  "AWS_SECRET_ACCESS_KEY", "JARVIS_PASSWORD", "JARVIS_ALLOW_COMPUTER",
]) {
  eq(`${name} is removed`, env[name], undefined);
}
eq(
  "no secret value survives under any name",
  Object.values(env).some((v) => /should_not_leak/.test(String(v))),
  false,
);
eq("PATH is kept so commands still run", typeof env.PATH, "string");
eq("NODE_ENV is kept", typeof env.NODE_ENV, "string");

console.log("\n--- the gate ---");
delete process.env.JARVIS_ALLOW_COMPUTER;
eq("computer access is off unless explicitly enabled", computerAccessEnabled(), false);
process.env.JARVIS_ALLOW_COMPUTER = "true";
eq('only the exact value "1" enables it', computerAccessEnabled(), false);
process.env.JARVIS_ALLOW_COMPUTER = "1";
eq('"1" enables it', computerAccessEnabled(), true);

console.log("\n--- auth boundary ---");
{
  const auth = await import("../lib/auth/session");

  // Headers are client-supplied and pass straight through the dev server, so
  // a locality decision must never rest on them alone. The loopback bind is
  // the real boundary; these assertions pin the policy that sits on top.
  delete process.env.JARVIS_OPEN_NETWORK;
  eq("loopback host needs no auth when bound to loopback", auth.requiresAuth("localhost:3000"), false);
  eq("127.0.0.1 host likewise", auth.requiresAuth("127.0.0.1:3000"), false);
  eq("[::1] host likewise", auth.requiresAuth("[::1]:3000"), false);
  eq("a tunnel hostname requires auth", auth.requiresAuth("abc.trycloudflare.com"), true);
  eq("a LAN IP host requires auth", auth.requiresAuth("192.168.1.50:3000"), true);
  eq("a missing host requires auth", auth.requiresAuth(null), true);
  // "localhost.evil.com" must not pass as loopback.
  eq("a lookalike hostname requires auth", auth.requiresAuth("localhost.evil.com"), true);

  process.env.JARVIS_OPEN_NETWORK = "1";
  eq("listening on the network requires auth even for a loopback host", auth.requiresAuth("localhost:3000"), true);
  delete process.env.JARVIS_OPEN_NETWORK;

  // Signing key is derived from the password, so changing it logs everyone out.
  process.env.JARVIS_PASSWORD = "first-password";
  const token = await auth.createToken();
  eq("a freshly signed token verifies", await auth.verifyToken(token), true);
  eq("a tampered token does not", await auth.verifyToken(token.slice(0, -1) + "X"), false);
  eq("a garbage token does not", await auth.verifyToken("nonsense"), false);
  eq("an empty token does not", await auth.verifyToken(undefined), false);

  process.env.JARVIS_PASSWORD = "second-password";
  eq("changing the password invalidates old sessions", await auth.verifyToken(token), false);

  eq("the right password matches", auth.passwordMatches("second-password"), true);
  eq("a wrong password does not", auth.passwordMatches("first-password"), false);
  eq("a prefix of the password does not", auth.passwordMatches("second"), false);
  delete process.env.JARVIS_PASSWORD;
  eq("no password configured means nothing matches", auth.passwordMatches(""), false);
  eq("authConfigured is false when unset", auth.authConfigured(), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
