export interface NostrUnsignedEvent {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
}

export interface NostrSignedEvent extends NostrUnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey?: () => Promise<string>;
      signEvent?: (event: NostrUnsignedEvent) => Promise<NostrSignedEvent>;
    };
  }
}

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]) {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= generator[i];
    }
  }
  return chk;
}

function hrpExpand(hrp: string) {
  const result: number[] = [];
  for (let i = 0; i < hrp.length; i++) result.push(hrp.charCodeAt(i) >> 5);
  result.push(0);
  for (let i = 0; i < hrp.length; i++) result.push(hrp.charCodeAt(i) & 31);
  return result;
}

function createChecksum(hrp: string, data: number[]) {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const result: number[] = [];
  for (let i = 0; i < 6; i++) result.push((mod >> (5 * (5 - i))) & 31);
  return result;
}

function convertBits(data: number[], from: number, to: number, pad: boolean) {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) throw new Error("Invalid Nostr pubkey");
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      result.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) result.push((acc << (to - bits)) & maxv);
  return result;
}

export function hexToNpub(hex: string) {
  const clean = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error("Invalid Nostr pubkey");
  const bytes = clean.match(/.{2}/g)!.map((part) => parseInt(part, 16));
  const data = convertBits(bytes, 8, 5, true);
  const combined = data.concat(createChecksum("npub", data));
  return `npub1${combined.map((value) => CHARSET[value]).join("")}`;
}

export async function getExtensionNpub() {
  const pubkey = await window.nostr?.getPublicKey?.();
  return pubkey ? hexToNpub(pubkey) : null;
}

export function npubToHex(npub: string): string {
  if (!npub.toLowerCase().startsWith("npub1"))
    throw new Error("Not an npub bech32 string");
  const lower = npub.toLowerCase();
  const sep = lower.lastIndexOf("1");
  const data5: number[] = [];
  for (let i = sep + 1; i < lower.length - 6; i++) {
    const v = CHARSET.indexOf(lower[i]);
    if (v < 0) throw new Error(`Invalid bech32 character: ${lower[i]}`);
    data5.push(v);
  }
  const bytes = convertBits(data5, 5, 8, false);
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function pubkeyHexFromInput(input: string): string {
  const s = input.trim();
  if (s.startsWith("npub1")) return npubToHex(s);
  if (/^[0-9a-fA-F]{64}$/.test(s)) return s.toLowerCase();
  throw new Error("Expected npub1… or 64-char hex pubkey");
}

export function publishToRelay(wsUrl: string, event: NostrSignedEvent): Promise<string> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Relay timed out"));
    }, 10000);
    ws.onopen = () => ws.send(JSON.stringify(["EVENT", event]));
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as unknown[];
        if (Array.isArray(msg) && msg[0] === "OK") {
          clearTimeout(timer);
          ws.close();
          if (msg[2]) resolve(typeof msg[3] === "string" ? msg[3] : "Published");
          else reject(new Error(typeof msg[3] === "string" ? msg[3] : "Relay rejected the event"));
        }
      } catch { /* ignore non-EVENT messages */ }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error("WebSocket error")); };
  });
}
