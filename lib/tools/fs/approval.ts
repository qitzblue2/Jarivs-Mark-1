import { newId } from "@/lib/types";

/**
 * Human-in-the-loop gate for anything that changes your machine.
 *
 * A pending request parks a promise here; the UI shows what is about to
 * happen and a POST to /api/approve resolves it. Nothing runs on the model's
 * word alone.
 *
 * Denial is the default: if no answer arrives before the timeout, the request
 * is refused. Failing open here would mean a tab left in the background
 * quietly approving everything.
 */

export interface ApprovalRequest {
  id: string;
  kind: "write" | "command";
  /** One-line summary for the card, e.g. the command itself. */
  summary: string;
  /** Full detail — file contents, or a diff. */
  detail?: string;
  path?: string;
  createdAt: number;
}

export type ApprovalDecision = "approve" | "deny";

/**
 * A standing "yes" for writes, for the length of one task run.
 *
 * Twenty steps meant twenty cards, and one missed click denied on timeout and
 * derailed the run — so the gate was unusable exactly where it mattered most.
 *
 * Deliberately narrow. It covers `write` only: a write cannot leave the
 * workspace, because workspace.ts resolves the real path and re-checks
 * containment after following symlinks. `command` is never covered, because a
 * shell command's blast radius is not bounded by anything this process
 * controls, so it stays one decision each however long the run.
 *
 * Held beside `pending` in the shared gate below, cleared by `denyAll()` — so aborting a turn or
 * dropping the connection also revokes it, and it can never outlive the run
 * that asked for it.
 */
/** Called when the user picks "allow writes for this run" on a card. */
export function grantWritesForRun(): void {
  gate().writeGrant = true;
}

export function writesGranted(): boolean {
  return gate().writeGrant;
}

interface Pending {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

const TIMEOUT_MS = 5 * 60 * 1000;

/**
 * One gate per process, on globalThis rather than in module variables.
 *
 * The tool asking and the /api/approve route answering run in the same
 * process, but not necessarily with the same copy of this module: a bundler
 * can give separate routes their own copy, and tsx loads a file twice when
 * it is reached as both ESM and CommonJS. Two copies means two maps, and an
 * approval that lands in the one nobody is waiting on — the request then
 * sits until it times out and is denied.
 */
const shared = globalThis as { __jarvisApprovals?: { pending: Map<string, Pending>; writeGrant: boolean } };
function gate() {
  shared.__jarvisApprovals ??= { pending: new Map(), writeGrant: false };
  return shared.__jarvisApprovals;
}

export function requestApproval(
  input: Omit<ApprovalRequest, "id" | "createdAt">,
  onCreated: (request: ApprovalRequest) => void,
): Promise<ApprovalDecision> {
  // A run-scoped grant answers for writes without a card. Commands always ask.
  if (input.kind === "write" && gate().writeGrant) return Promise.resolve("approve");

  const request: ApprovalRequest = { ...input, id: newId(), createdAt: Date.now() };

  return new Promise<ApprovalDecision>((resolve) => {
    const timer = setTimeout(() => {
      gate().pending.delete(request.id);
      resolve("deny");
    }, TIMEOUT_MS);

    // Don't hold the process open just for a pending approval.
    timer.unref?.();

    gate().pending.set(request.id, { request, resolve, timer });
    onCreated(request);
  });
}

/** Called by the API route. Returns false if the id is unknown or expired. */
export function settleApproval(id: string, decision: ApprovalDecision): boolean {
  const entry = gate().pending.get(id);
  if (!entry) return false;

  clearTimeout(entry.timer);
  gate().pending.delete(id);
  entry.resolve(decision);
  return true;
}

/**
 * Deny everything outstanding — used when a turn is aborted.
 *
 * Also revokes the run-scoped write grant. That pairing is the point: the
 * grant is only ever as long as the run, and a turn that ends for any
 * reason — finished, aborted, disconnected — ends it too.
 */
export function denyAll(): void {
  gate().writeGrant = false;
  for (const id of [...gate().pending.keys()]) settleApproval(id, "deny");
}

export function pendingCount(): number {
  return gate().pending.size;
}
