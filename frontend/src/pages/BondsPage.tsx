import { createResource, createSignal, For, onCleanup, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchBonds, getOrder, type Bond, type Order } from "../api";
import { listSavedOrders, removeOrder, type SavedOrder } from "../orderHistory";
import { listSelfCerts, removeSelfCert, type SavedSelfCert } from "../selfCertHistory";
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
function monthYear(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long" });
}
function dateTime(ts: number) { return new Date(ts * 1000).toLocaleString(); }
function pad(n: number) { return String(n).padStart(2, "0"); }

function expiryLabel(expireTs: number, nowMs: number) {
  const diff = Math.max(0, expireTs * 1000 - nowMs);
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
function expiryPct(expireTs: number, nowMs: number) {
  const remaining = Math.max(0, expireTs * 1000 - nowMs);
  return Math.min(100, (remaining / ONE_YEAR_MS) * 100);
}

export default function BondsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = createSignal<"bonds" | "certs">("bonds");
  const [bonds, { refetch: refetchBonds }] = createResource(fetchBonds);
  const [items, { refetch: refetchItems }] = createResource(fetchSavedOrders);
  const [selfCerts, setSelfCerts] = createSignal<SavedSelfCert[]>(listSelfCerts());

  function forgetSelfCert(id: string) {
    removeSelfCert(id);
    setSelfCerts(listSelfCerts());
  }
  const [now, setNow] = createSignal(Date.now());

  const ticker = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(ticker));

  function buy(bond: Bond) {
    navigate(`/order/new?bond_id=${bond.id}&bond_name=${encodeURIComponent(bond.name)}`);
  }

  function forget(order_id: string) {
    removeOrder(order_id);
    void refetchItems();
  }

  return (
    <div class="page page--wide">

      {/* ── Bonds tab ── */}
      <Show when={tab() === "bonds"}>
        <Show when={bonds.loading}>
          <p class="muted center">Loading bonds…</p>
        </Show>
        <Show when={bonds.error}>
          <div class="error-box">
            <p>Could not load bonds: {String(bonds.error)}</p>
            <button class="btn-secondary" onClick={refetchBonds}>Retry</button>
          </div>
        </Show>
        <Show when={!bonds.loading && bonds()}>
          <Show
            when={(bonds() ?? []).length > 0}
            fallback={<p class="muted center">No bonds available right now.</p>}
          >
            <div class="bond-grid">
              <For each={bonds()}>
                {(bond) => (
                  <div class="bond-card">
                    <div class="bond-card-header">
                      <h2>{bond.name}</h2>
                      <span class={`badge badge-${bond.status.toLowerCase()}`}>
                        {bond.status.replace("_", " ")}
                      </span>
                    </div>
                    <Show when={bond.description}>
                      <p class="bond-desc">{bond.description}</p>
                    </Show>
                    <dl class="stats">
                      <div>
                        <dt>Price per slot</dt>
                        <dd class="accent">{sats(bond.price_per_slot_sats)}</dd>
                      </div>
                      <div>
                        <dt>Bond size</dt>
                        <dd>{sats(bond.bond_sats)}</dd>
                      </div>
                      <div>
                        <dt>Locked until</dt>
                        <dd>{monthYear(bond.timelock_expiry)}</dd>
                      </div>
                      <div>
                        <dt>Service fee</dt>
                        <dd>{(bond.fee_rate * 100).toFixed(0)}%</dd>
                      </div>
                    </dl>
                    <div class="slot-progress">
                      <div class="slot-progress-row">
                        <span class="slot-progress-sublabel muted">Used</span>
                        <div class="slot-bar">
                          <div
                            class="slot-bar-fill"
                            style={{ width: `${((bond.max_slots - bond.slots_available) / bond.max_slots) * 100}%` }}
                          />
                        </div>
                        <span class="slot-progress-count">
                          {bond.max_slots - bond.slots_available}
                          <span class="muted"> / {bond.max_slots}</span>
                        </span>
                      </div>
                      <div class="slot-progress-row">
                        <span class="slot-progress-sublabel muted">Expires</span>
                        <div class="slot-bar">
                          <div
                            class="slot-bar-fill slot-bar-fill--green"
                            style={{ width: `${expiryPct(bond.timelock_expiry, now())}%` }}
                          />
                        </div>
                        <span class="slot-progress-count bond-expiry-timer">
                          {expiryLabel(bond.timelock_expiry, now())}
                        </span>
                      </div>
                    </div>
                    <button
                      class="btn-primary"
                      disabled={bond.slots_available === 0}
                      onClick={() => buy(bond)}
                    >
                      {bond.slots_available > 0 ? "Get Certificate" : "Sold Out"}
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>

      {/* ── My Certificates tab ── */}
      <Show when={tab() === "certs"}>
        <div class="certs-tab-actions">
          <button type="button" class="btn-secondary" onClick={() => navigate("/import")}>
            Import Certificate
          </button>
          <button type="button" class="btn-secondary" onClick={() => navigate("/wallet")}>
            Create self-signed
          </button>
        </div>

        {/* Self-signed certs */}
        <Show when={selfCerts().length > 0}>
          <p class="card-section-title" style={{ margin: "1.25rem 0 0.75rem" }}>Self-signed</p>
          <div class="bond-grid">
            <For each={selfCerts()}>
              {(sc) => (
                <div class="bond-card">
                  <div class="bond-card-header">
                    <h2>Self-signed cert</h2>
                    <span class="badge badge-available">signed</span>
                  </div>
                  <dl class="stats">
                    <div>
                      <dt>Nostr pubkey</dt>
                      <dd class="mono-short">{sc.nostr_pubkey_hex.slice(0, 12)}…</dd>
                    </div>
                    <div>
                      <dt>Bond locked until</dt>
                      <dd>{sc.bond_lock_date}</dd>
                    </div>
                    <div>
                      <dt>Cert expires ~</dt>
                      <dd class="accent">{sc.cert_expiry_date}</dd>
                    </div>
                    <div>
                      <dt>Bond index</dt>
                      <dd>{sc.bond_index}</dd>
                    </div>
                  </dl>
                  <div class="button-row">
                    <button
                      type="button"
                      class="btn-secondary"
                      onClick={() => navigator.clipboard.writeText(JSON.stringify({
                        message: sc.message,
                        bond_pubkey: sc.bond_pubkey_hex,
                        cert_pubkey: sc.nostr_pubkey_hex,
                        cert_expiry: sc.cert_expiry,
                        expiry_approx_date: sc.cert_expiry_date,
                        signature: sc.signature_base64,
                      }, null, 2))}
                    >
                      Copy JSON
                    </button>
                    <button
                      type="button"
                      class="btn-secondary"
                      onClick={() => forgetSelfCert(sc.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Service-issued orders */}
        <Show when={(selfCerts().length > 0) || (items() ?? []).length > 0}>
          <p class="card-section-title" style={{ margin: "1.25rem 0 0.75rem" }}>Service-issued</p>
        </Show>
        <Show when={items.loading}>
          <p class="muted center">Loading…</p>
        </Show>
        <Show when={!items.loading && items()}>
          <Show
            when={(items() ?? []).length > 0}
            fallback={
              <Show when={selfCerts().length === 0}>
                <p class="muted center">No certificates saved in this browser.</p>
              </Show>
            }
          >
            <div class="bond-grid">
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
      </Show>

      <Footer />
    </div>
  );
}
