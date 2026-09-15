import { NextRequest } from "next/server";
import { parseMac, wake } from "@/lib/wake-on-lan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Send a wake packet, for the Test button in Settings.
 *
 * Separate from the automatic wake in the chat route because this one is a
 * deliberate act: you are asking whether Wake-on-LAN is configured at all, so
 * it bypasses the cooldown and reports exactly what happened rather than
 * quietly declining.
 *
 * A magic packet can only turn a machine on, carries no payload, and does not
 * route off the local network — so unlike the endpoint URL there is nothing
 * here an attacker gains from. The MAC is still validated strictly, because a
 * typo that parsed loosely would broadcast to the wrong address and look
 * exactly like the feature not working.
 */
export async function POST(req: NextRequest) {
  let body: { mac?: string };
  try {
    body = (await req.json()) as { mac?: string };
  } catch {
    return Response.json({ sent: false, reason: "Malformed request body." }, { status: 400 });
  }

  const mac = parseMac(body.mac);
  if (!mac) {
    return Response.json(
      { sent: false, reason: "That isn't a MAC address. Expected something like a1:b2:c3:d4:e5:f6." },
      { status: 400 },
    );
  }

  // Forced: the point of pressing Test is to send one now.
  const result = await wake(mac, { force: true });
  return Response.json(result, { status: result.sent ? 200 : 500 });
}
