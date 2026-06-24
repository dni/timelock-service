import { createResource, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchBonds, type Bond } from "../api";

function sats(n: number) {
  return n.toLocaleString() + " sats";
}

function monthYear(ts: number) {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
  });
}

export default function BondList() {
  const [bonds, { refetch }] = createResource(fetchBonds);
  const navigate = useNavigate();

  function buy(bond: Bond) {
    navigate(`/order?bond_id=${bond.id}&bond_name=${encodeURIComponent(bond.name)}`);
  }

  return (
    <div class="page">
      <header class="site-header">
        <h1>Timelock</h1>
        <p class="subtitle">NIP-600 fidelity bond certificates over Lightning</p>
      </header>

      <Show when={bonds.loading}>
        <p class="muted center">Loading bonds…</p>
      </Show>

      <Show when={bonds.error}>
        <div class="error-box">
          <p>Could not load bonds: {String(bonds.error)}</p>
          <button class="btn-secondary" onClick={refetch}>
            Retry
          </button>
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
                      <dt>Slots available</dt>
                      <dd>
                        {bond.slots_available}{" "}
                        <span class="muted">/ {bond.max_slots}</span>
                      </dd>
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
    </div>
  );
}
