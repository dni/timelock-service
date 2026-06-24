const KEY = "timelock.self_certs.v1";

export interface SavedSelfCert {
  id: string;
  created_at: number;
  nostr_pubkey_hex: string;
  bond_pubkey_hex: string;
  bond_address: string;
  bond_index: number;
  bond_lock_date: string;
  cert_expiry: number;
  cert_expiry_date: string;
  message: string;
  signature_base64: string;
}

function read(): SavedSelfCert[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedSelfCert[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(certs: SavedSelfCert[]) {
  localStorage.setItem(KEY, JSON.stringify(certs));
}

export function listSelfCerts(): SavedSelfCert[] {
  return read().sort((a, b) => b.created_at - a.created_at);
}

export function saveSelfCert(cert: SavedSelfCert) {
  const certs = read().filter((c) => c.id !== cert.id);
  certs.unshift(cert);
  write(certs.slice(0, 100));
}

export function removeSelfCert(id: string) {
  write(read().filter((c) => c.id !== id));
}
