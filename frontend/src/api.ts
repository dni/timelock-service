const BASE = "/api/v1";

export interface Bond {
  id: string;
  name: string;
  description: string;
  max_slots: number;
  slots_available: number;
  bond_sats: number;
  price_per_slot_sats: number;
  fee_rate: number;
  timelock_expiry: number;
  status: string;
}

export interface Order {
  order_id: string;
  state: "PENDING_PAYMENT" | "PAID" | "EXPIRED";
  beneficiary_pubkey: string;
  invoice: string;
  payment_hash: string;
  price_sats: number;
  bond_sats: number;
  encrypted_cert: string | null;
  cert_nonce: string | null;
  timelocked_address: string;
  bond_expiry: number;
  expires_at: number;
  paid_at: number | null;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      msg = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const fetchBonds = () => apiFetch<Bond[]>("/bonds");

export const requestBond = (bond_id: string, npub: string) =>
  apiFetch<Order>("/bond/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bond_id, npub }),
  });

export const getOrder = (order_id: string) =>
  apiFetch<Order>(`/bond/${order_id}`);

export const getOrderPreimage = (order_id: string) =>
  apiFetch<{ preimage: string }>(`/bond/${order_id}/preimage`);

export const refreshOrder = (order_id: string) =>
  apiFetch<Order>(`/bond/${order_id}/refresh`, { method: "POST" });

export function orderStatusWebSocketUrl(order_id: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${BASE}/bond/${order_id}/ws`;
}
