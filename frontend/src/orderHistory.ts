const KEY = "timelock.orders.v1";

export interface SavedOrder {
  order_id: string;
  bond_name: string;
  created_at: number;
  preimage_hex?: string;
}

function read(): SavedOrder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedOrder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(orders: SavedOrder[]) {
  localStorage.setItem(KEY, JSON.stringify(orders));
}

export function listSavedOrders() {
  return read().sort((a, b) => b.created_at - a.created_at);
}

export function saveOrder(order: SavedOrder) {
  const orders = read().filter((item) => item.order_id !== order.order_id);
  orders.unshift(order);
  write(orders.slice(0, 100));
}

export function getSavedOrder(order_id: string) {
  return read().find((item) => item.order_id === order_id) ?? null;
}

export function saveOrderPreimage(order_id: string, preimage_hex: string) {
  const orders = read();
  const index = orders.findIndex((item) => item.order_id === order_id);
  if (index === -1) return;
  orders[index] = { ...orders[index], preimage_hex };
  write(orders);
}

export function removeOrder(order_id: string) {
  write(read().filter((item) => item.order_id !== order_id));
}
