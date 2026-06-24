const KEY = "timelock.my_bonds.v1";

export interface SavedBondCert {
  id: string;
  created_at: number;
  nostr_pubkey_hex: string;
  bond_pubkey_hex: string;
  cert_expiry: number;
  cert_expiry_date: string;
  message: string;
  signature_base64: string;
}

export interface SavedBond {
  id: string;
  created_at: number;
  address: string;
  bond_index: number;
  bond_lock_date: string;
  timelock_ts: number;
  pubkey_hex: string;
  witness_script_hex: string;
  certs: SavedBondCert[];
}

function read(): SavedBond[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedBond[];
    if (!Array.isArray(raw)) return [];
    // migrate old records that have a single `cert` field
    return raw.map((b: SavedBond & { cert?: SavedBondCert }) => {
      if (!b.certs && b.cert) return { ...b, certs: [b.cert], cert: undefined };
      if (!b.certs) return { ...b, certs: [] };
      return b;
    });
  } catch {
    return [];
  }
}

function write(bonds: SavedBond[]) {
  localStorage.setItem(KEY, JSON.stringify(bonds));
}

export function listMyBonds(): SavedBond[] {
  return read().sort((a, b) => b.created_at - a.created_at);
}

export function saveMyBond(bond: SavedBond) {
  const all = read().filter((b) => b.id !== bond.id);
  all.unshift(bond);
  write(all.slice(0, 200));
}

export function addCertToMyBond(id: string, cert: SavedBondCert) {
  const all = read();
  const idx = all.findIndex((b) => b.id === id);
  if (idx === -1) return;
  const existing = all[idx].certs.filter((c) => c.id !== cert.id);
  all[idx] = { ...all[idx], certs: [...existing, cert] };
  write(all);
}

export function removeCertFromMyBond(bondId: string, certId: string) {
  const all = read();
  const idx = all.findIndex((b) => b.id === bondId);
  if (idx === -1) return;
  all[idx] = { ...all[idx], certs: all[idx].certs.filter((c) => c.id !== certId) };
  write(all);
}

export function removeMyBond(id: string) {
  write(read().filter((b) => b.id !== id));
}

export function listCertifiedBonds(): SavedBond[] {
  return read().filter((b) => b.certs.length > 0).sort((a, b) => b.created_at - a.created_at);
}
