import { createResource, createSignal, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { getOrder, type Order } from "../api";
import { listSavedOrders, removeOrder, type SavedOrder } from "../orderHistory";
import { listCertifiedBonds, removeCertFromMyBond, type SavedBond, type SavedBondCert } from "../myBondHistory";
import Footer from "../Footer";

type SavedOrderWithStatus = SavedOrder & { order: Order | null; error: string | null };

async function fetchSavedOrders(): Promise<SavedOrderWithStatus[]> {
  const saved = listSavedOrders();
  return Promise.all(
    saved.map(async (item) => {
      try {
        return { ...item, order: await getOrder(item.order_id), error: null };
      } catch (err) {
        return { ...item, order: null, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

function sats(n: number) { return n.toLocaleString() + " sats"; }
function dateTime(ts: number) { return new Date(ts * 1000).toLocaleString(); }

export default function CertificatesPage() {
  const navigate = useNavigate();
  const [orders, { refetch }] = createResource(fetchSavedOrders);
  const [selfCerts, setSelfCerts] = createSignal<SavedBond[]>(listCertifiedBonds());

  function forgetOrder(order_id: string) {
    removeOrder(order_id);
    void refetch();
  }

  function forgetCert(bondId: string, certId: string) {
    removeCertFromMyBond(bondId, certId);
    setSelfCerts(listCertifiedBonds());
  }

  // flatten bonds → individual cert rows for display
  const certRows = () =>
    selfCerts().flatMap((bond) =>
      bond.certs.map((cert) => ({ bond, cert })),
    );

  const hasSelf = () => certRows().length > 0;
  const hasService = () => (orders() ?? []).length > 0;
  const hasAny = () => hasSelf() || hasService();

  return (
    <div class="page page--wide">
      <button class="btn-back" type="button" onClick={() => navigate("/")}>← Back</button>

      <div style={{ display: "flex", "align-items": "center", gap: "1rem", "margin-bottom": "1.5rem", "flex-wrap": "wrap" }}>
        <h2 class="order-title" style={{ margin: 0 }}>My Certificates</h2>
        <div style={{ display: "flex", gap: "0.5rem", "margin-left": "auto" }}>
          <button type="button" class="btn-secondary" onClick={() => navigate("/import")}>
            Import
          </button>
          <button type="button" class="btn-secondary" onClick={() => navigate("/wallet")}>
            Create self-signed →
          </button>
        </div>
      </div>

      <Show when={!hasAny() && !orders.loading}>
        <p class="muted center">No certificates saved in this browser.</p>
      </Show>

      {/* Self-signed */}
      <Show when={hasSelf()}>
        <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>Self-signed</p>
        <div class="bond-grid">
          <For each={certRows()}>
            {({ bond, cert }) => (
              <div class="bond-card">
                <div class="bond-card-header">
                  <h2>Self-signed cert</h2>
                  <span class="badge badge-available">signed</span>
                </div>
                <dl class="stats">
                  <div>
                    <dt>Nostr pubkey</dt>
                    <dd class="mono-short">{cert.nostr_pubkey_hex.slice(0, 16)}…</dd>
                  </div>
                  <div>
                    <dt>Bond #{bond.bond_index}</dt>
                    <dd>{bond.bond_lock_date}</dd>
                  </div>
                  <div>
                    <dt>Cert expires ~</dt>
                    <dd class="accent">{cert.cert_expiry_date}</dd>
                  </div>
                </dl>
                <div class="button-row">
                  <button
                    type="button"
                    class="btn-primary"
                    onClick={() =>
                      navigator.clipboard.writeText(
                        JSON.stringify({
                          message: cert.message,
                          bond_pubkey: cert.bond_pubkey_hex,
                          cert_pubkey: cert.nostr_pubkey_hex,
                          cert_expiry: cert.cert_expiry,
                          expiry_approx_date: cert.cert_expiry_date,
                          signature: cert.signature_base64,
                        }, null, 2),
                      )
                    }
                  >
                    Copy JSON
                  </button>
                  <button
                    type="button"
                    class="btn-secondary"
                    onClick={() => navigate("/my-bonds")}
                  >
                    View bond
                  </button>
                  <button
                    type="button"
                    class="btn-secondary"
                    onClick={() => forgetCert(bond.id, cert.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Service-issued */}
      <Show when={hasSelf() && hasService()}>
        <p class="card-section-title" style={{ margin: "1.5rem 0 0.75rem" }}>Service-issued</p>
      </Show>
      <Show when={orders.loading}>
        <p class="muted center">Loading…</p>
      </Show>
      <Show when={!orders.loading && hasService()}>
        <div class="bond-grid">
          <For each={orders()}>
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
                  <p class="bond-desc">Could not load: {item.error}</p>
                </Show>
                <div class="button-row">
                  <button type="button" class="btn-primary" onClick={() => navigate(`/order/${item.order_id}`)}>
                    Open
                  </button>
                  <button type="button" class="btn-secondary" onClick={() => forgetOrder(item.order_id)}>
                    Remove
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Footer />
    </div>
  );
}
