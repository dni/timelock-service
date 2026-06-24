const KEY = "timelock.orders.v1";

export interface SavedOrder {
  order_id: string;
  bond_name: string;
  created_at: number;
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

export function removeOrder(order_id: string) {
  write(read().filter((item) => item.order_id !== order_id));
}
