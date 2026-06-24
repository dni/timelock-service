import { createResource, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import Footer from "../Footer";
import { getOrder, type Order } from "../api";
import { listSavedOrders, removeOrder, type SavedOrder } from "../orderHistory";

type SavedOrderWithStatus = SavedOrder & {
  order: Order | null;
  error: string | null;
};

async function fetchSavedOrders(): Promise<SavedOrderWithStatus[]> {
  const saved = listSavedOrders();
  return Promise.all(
    saved.map(async (item) => {
      try {
        return { ...item, order: await getOrder(item.order_id), error: null };
      } catch (err) {
        return {
          ...item,
          order: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );
}

function sats(n: number) {
  return n.toLocaleString() + " sats";
}

function dateTime(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

export default function CertificatesPage() {
  const navigate = useNavigate();
  const [items, { refetch }] = createResource(fetchSavedOrders);

  function forget(order_id: string) {
    removeOrder(order_id);
    void refetch();
  }

  return (
    <div class="page">
      <button class="btn-back" type="button" onClick={() => navigate("/")}>
        ← Back
      </button>

      <header class="site-header compact">
        <h1>My Certificates</h1>
        <p class="subtitle">Order history saved in this browser.</p>
        <button
          type="button"
          class="btn-secondary nav-action"
          onClick={() => navigate("/import")}
        >
          Import Certificate
        </button>
      </header>

      <Show when={items.loading}>
        <p class="muted center">Loading certificates…</p>
      </Show>

      <Show when={!items.loading && items()}>
        <Show
          when={(items() ?? []).length > 0}
          fallback={<p class="muted center">No certificate orders saved in this browser.</p>}
        >
          <div class="cert-list">
            <For each={items()}>
              {(item) => (
                <div class="bond-card">
                  <div class="bond-card-header">
                    <h2>{item.bond_name || "Certificate order"}</h2>
                    <Show when={item.order}>
                      {(order) => (
                        <span class={`badge badge-${order().state.toLowerCase()}`}>
                          {order().state.replace("_", " ")}
                        </span>
                      )}
                    </Show>
                  </div>

                  <dl class="stats">
                    <div>
                      <dt>Order</dt>
                      <dd class="mono-short">{item.order_id.slice(0, 8)}…</dd>
                    </div>
                    <div>
                      <dt>Preimage</dt>
                      <dd>{item.preimage_hex ? "Saved locally" : "Not saved"}</dd>
                    </div>
                    <Show when={item.order}>
                      {(order) => (
                        <>
                          <div>
                            <dt>Amount</dt>
                            <dd class="accent">{sats(order().price_sats)}</dd>
                          </div>
                          <div>
                            <dt>Payment hash</dt>
                            <dd class="mono-short">{order().payment_hash.slice(0, 8)}…</dd>
                          </div>
                          <div>
                            <dt>Expires</dt>
                            <dd>{dateTime(order().expires_at)}</dd>
                          </div>
                        </>
                      )}
                    </Show>
                  </dl>

                  <Show when={item.error}>
                    <p class="bond-desc">Could not load this order: {item.error}</p>
                  </Show>

                  <div class="button-row">
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={() => navigate(`/order/${item.order_id}`)}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      class="btn-secondary"
                      onClick={() => forget(item.order_id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
      <Footer />
    </div>
  );
}
