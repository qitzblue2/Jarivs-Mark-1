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

interface Pending {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

const TIMEOUT_MS = 5 * 60 * 1000;

// Module-level: the route handler and the tool handler run in the same
// process, so a shared map is all the coordination needed.
const pending = new Map<string, Pending>();

export function requestApproval(
  input: Omit<ApprovalRequest, "id" | "createdAt">,
  onCreated: (request: ApprovalRequest) => void,
): Promise<ApprovalDecision> {
  const request: ApprovalRequest = { ...input, id: newId(), createdAt: Date.now() };

  return new Promise<ApprovalDecision>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(request.id);
      resolve("deny");
    }, TIMEOUT_MS);

    // Don't hold the process open just for a pending approval.
    timer.unref?.();

    pending.set(request.id, { request, resolve, timer });
    onCreated(request);
  });
}

/** Called by the API route. Returns false if the id is unknown or expired. */
export function settleApproval(id: string, decision: ApprovalDecision): boolean {
  const entry = pending.get(id);
  if (!entry) return false;

  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(decision);
  return true;
}

/** Deny everything outstanding — used when a turn is aborted. */
export function denyAll(): void {
  for (const id of [...pending.keys()]) settleApproval(id, "deny");
}

export function pendingCount(): number {
  return pending.size;
}
