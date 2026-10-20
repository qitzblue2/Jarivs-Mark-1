import dgram from "node:dgram";

/**
 * Waking a machine that is asleep.
 *
 * A magic packet is six 0xFF bytes followed by the target MAC repeated
 * sixteen times — 102 bytes, broadcast over UDP. The network card watches for
 * exactly that pattern while the rest of the machine is powered down.
 *
 * Which is why the builder below is pure and tested byte by byte: a packet
 * that is one byte wrong is not rejected, it is silently ignored, and the
 * only symptom is a machine that never wakes. There is nothing to debug at
 * runtime, so it gets debugged here instead.
 *
 * Nothing model-supplied reaches this. The MAC comes from Settings or the
 * environment, and a magic packet carries no payload beyond the address — it
 * cannot do anything to a machine except turn it on, and it does not route
 * off the local network.
 */

/** Broadcast port. 9 (discard) is conventional; 7 also works. */
const PORT = 9;
const DEFAULT_BROADCAST = "255.255.255.255";

/** One packet per machine per this long — a booting PC needs no reminders. */
const COOLDOWN_MS = 90_000;

const lastSent = new Map<string, number>();

/**
 * Normalise a MAC, or reject it.
 *
 * Strict on purpose: this becomes a broadcast on your network, and a typo
 * that parsed loosely would send a valid packet to the wrong address and look
 * exactly like Wake-on-LAN not working.
 */
export function parseMac(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  // Accept colons or dashes, reject anything else — notably an IP address,
  // which is the most likely thing to be pasted here by mistake.
  if (!/^[0-9a-f]{2}([:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}$/i.test(trimmed)) return null;

  return trimmed.toLowerCase().replace(/-/g, ":");
}

/** The 102 bytes a sleeping network card is listening for. */
export function magicPacket(mac: string): Buffer {
  const normalised = parseMac(mac);
  if (!normalised) throw new Error(`Not a MAC address: ${mac}`);

  const address = Buffer.from(normalised.split(":").map((byte) => parseInt(byte, 16)));
  const packet = Buffer.alloc(6 + 16 * 6, 0xff);
  for (let i = 0; i < 16; i++) address.copy(packet, 6 + i * 6);
  return packet;
}

/** Milliseconds until another packet is worth sending; 0 if now. */
export function wakeCooldown(mac: string): number {
  const normalised = parseMac(mac);
  if (!normalised) return 0;
  const sent = lastSent.get(normalised);
  if (!sent) return 0;
  return Math.max(0, sent + COOLDOWN_MS - Date.now());
}

export interface WakeOptions {
  /** Defaults to 255.255.255.255; override for a subnet that filters it. */
  broadcast?: string;
  port?: number;
  /** Send even if the cooldown has not expired. For the Test button. */
  force?: boolean;
}

export interface WakeResult {
  sent: boolean;
  mac: string | null;
  /** Why it wasn't sent, when it wasn't. */
  reason?: string;
}

/**
 * Send the packet. Resolves once it is on the wire, not once anything wakes.
 *
 * There is no acknowledgement in Wake-on-LAN — a sleeping machine cannot
 * reply — so this deliberately reports only that the packet left. Claiming
 * the machine woke would be a guess, and a wrong one every time the BIOS
 * setting is off.
 */
export async function wake(mac: string, options: WakeOptions = {}): Promise<WakeResult> {
  const normalised = parseMac(mac);
  if (!normalised) return { sent: false, mac: null, reason: `Not a MAC address: ${mac}` };

  if (!options.force) {
    const wait = wakeCooldown(normalised);
    if (wait > 0) {
      return {
        sent: false,
        mac: normalised,
        reason: `Already woken ${Math.round((COOLDOWN_MS - wait) / 1000)}s ago; still booting.`,
      };
    }
  }

  const packet = magicPacket(normalised);
  const broadcast = options.broadcast || process.env.JARVIS_LOCAL_BROADCAST || DEFAULT_BROADCAST;
  const port = options.port ?? PORT;

  return new Promise<WakeResult>((resolve) => {
    const socket = dgram.createSocket("udp4");

    const done = (result: WakeResult) => {
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(result);
    };

    socket.on("error", (err) =>
      done({ sent: false, mac: normalised, reason: `Could not send: ${err.message}` }),
    );

    socket.bind(() => {
      try {
        // Required before a datagram may go to a broadcast address.
        socket.setBroadcast(true);
      } catch (err) {
        return done({ sent: false, mac: normalised, reason: (err as Error).message });
      }

      socket.send(packet, port, broadcast, (err) => {
        if (err) return done({ sent: false, mac: normalised, reason: err.message });
        lastSent.set(normalised, Date.now());
        done({ sent: true, mac: normalised });
      });
    });
  });
}

/** Tests only. */
export function resetWakeHistory(): void {
  lastSent.clear();
}
