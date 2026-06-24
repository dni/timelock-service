declare global {
  interface Window {
    nostr?: {
      getPublicKey?: () => Promise<string>;
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
