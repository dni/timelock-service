import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import {
  listMyBonds, removeMyBond, removeCertFromMyBond, addCertToMyBond,
  type SavedBond,
} from "../myBondHistory";
import CertSignForm from "../CertSignForm";
import type { Certificate } from "../lib/types";
import Footer from "../Footer";

interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number };
}

type FundingStatus =
  | { state: "loading" }
  | { state: "funded"; sats: number; utxos: number; confirmed: boolean }
  | { state: "unfunded" }
  | { state: "error"; message: string };

async function checkFunding(address: string): Promise<FundingStatus> {
  try {
    const res = await fetch(`https://mempool.space/api/address/${address}/utxo`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const utxos: Utxo[] = await res.json();
    if (utxos.length === 0) return { state: "unfunded" };
    const sats = utxos.reduce((s, u) => s + u.value, 0);
    const confirmed = utxos.some((u) => u.status.confirmed);
    return { state: "funded", sats, utxos: utxos.length, confirmed };
  } catch (err) {
    return { state: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

function formatBtc(n: number) {
  return (n / 1e8).toFixed(8) + " BTC";
}


export default function MyBondsPage() {
  const navigate = useNavigate();
  const [bonds, setBonds] = createSignal<SavedBond[]>(listMyBonds());
  const [funding, setFunding] = createSignal<Record<string, FundingStatus>>({});

  const [activeForm, setActiveForm] = createSignal<string | null>(null);

  function openForm(bondId: string) { setActiveForm(bondId); }
  function closeForm() { setActiveForm(null); }

  function reload() { setBonds(listMyBonds()); }

  function forget(id: string) {
    removeMyBond(id);
    reload();
  }

  function onSigned(bondId: string, cert: Certificate) {
    addCertToMyBond(bondId, {
      id: crypto.randomUUID(),
      created_at: Math.floor(Date.now() / 1000),
      nostr_pubkey_hex: cert.certPubkeyHex,
      bond_pubkey_hex: cert.bondPubkeyHex,
      cert_expiry: cert.certExpiry,
      cert_expiry_date: cert.expiryApproxDate,
      message: cert.message,
      signature_base64: cert.signatureBase64,
    });
    reload();
    closeForm();
  }

  async function checkAll(list: SavedBond[]) {
    setFunding(Object.fromEntries(list.map((b) => [b.id, { state: "loading" as const }])));
    await Promise.all(
      list.map(async (b) => {
        const result = await checkFunding(b.address);
        setFunding((prev) => ({ ...prev, [b.id]: result }));
      }),
    );
  }

  onMount(() => {
    const list = bonds();
    if (list.length > 0) void checkAll(list);
  });

  const fundingBadge = (s: FundingStatus | undefined) => {
    if (!s || s.state === "loading") return <span class="badge badge-pending">checking…</span>;
    if (s.state === "unfunded") return <span class="badge badge-sold_out">unfunded</span>;
    if (s.state === "error") return <span class="badge badge-sold_out">error</span>;
    return s.confirmed
      ? <span class="badge badge-available">funded ✓</span>
      : <span class="badge badge-pending">unconfirmed</span>;
  };

  return (
    <div class="page page--wide">
      <div style={{ display: "flex", "align-items": "center", gap: "1rem", "margin-bottom": "1.5rem", "flex-wrap": "wrap" }}>
        <h2 class="order-title" style={{ margin: 0 }}>My Bonds</h2>
        <div style={{ display: "flex", gap: "0.5rem", "margin-left": "auto" }}>
          <button type="button" class="btn-secondary" onClick={() => void checkAll(bonds())}>
            Refresh funding
          </button>
          <button type="button" class="btn-secondary" onClick={() => navigate("/wallet")}>
            Create bond →
          </button>
        </div>
      </div>

      <Show
        when={bonds().length > 0}
        fallback={
          <div class="empty-state">
            <p class="muted">No bonds saved yet.</p>
            <p class="muted" style={{ "font-size": "0.875rem" }}>
              Derive a bond address in the{" "}
              <button type="button" class="link-btn" onClick={() => navigate("/wallet")}>wallet tool</button>
              {" "}and click Save Bond.
            </p>
          </div>
        }
      >
        <div class="bond-grid">
          <For each={bonds()}>
            {(bond) => {
              const fs = () => funding()[bond.id];
              const isOpen = () => activeForm() === bond.id;
              return (
                <div class="bond-card">
                  <div class="bond-card-header">
                    <h2>Bond #{bond.bond_index}</h2>
                    {fundingBadge(fs())}
                  </div>

                  <dl class="stats">
                    <div>
                      <dt>Locked until</dt>
                      <dd class="accent">{bond.bond_lock_date}</dd>
                    </div>
                    <div>
                      <dt>BIP46 index</dt>
                      <dd>{bond.bond_index}</dd>
                    </div>
                    <Show when={fs()?.state === "funded"}>
                      <div>
                        <dt>Funded</dt>
                        <dd class="accent">
                          {formatBtc((fs() as { state: "funded"; sats: number }).sats)}
                        </dd>
                      </div>
                      <div>
                        <dt>UTXOs</dt>
                        <dd>
                          {(fs() as { state: "funded"; utxos: number }).utxos} output
                          {(fs() as { state: "funded"; utxos: number }).utxos !== 1 ? "s" : ""}
                        </dd>
                      </div>
                    </Show>
                    <Show when={fs()?.state === "error"}>
                      <div>
                        <dt>Check failed</dt>
                        <dd class="muted">{(fs() as { state: "error"; message: string }).message}</dd>
                      </div>
                    </Show>
                  </dl>

                  <div class="field" style={{ "margin-top": "0.75rem" }}>
                    <p class="label">Address</p>
                    <code class="mono-wrap address-display" style={{ "font-size": "0.72rem" }}>
                      {bond.address}
                    </code>
                    <button
                      type="button"
                      class="btn-secondary"
                      style={{ "margin-top": "0.4rem" }}
                      onClick={() => navigator.clipboard.writeText(bond.address)}
                    >
                      Copy
                    </button>
                  </div>

                  {/* Certificate list */}
                  <Show when={bond.certs.length > 0}>
                    <div style={{ "margin-top": "0.75rem" }}>
                      <p class="card-section-title" style={{ "margin-bottom": "0.5rem" }}>
                        Certificates ({bond.certs.length})
                      </p>
                      <For each={bond.certs}>
                        {(cert) => (
                          <div class="cert-inline" style={{ "margin-bottom": "0.5rem" }}>
                            <dl class="stats">
                              <div>
                                <dt>Nostr pubkey</dt>
                                <dd class="mono-short">{cert.nostr_pubkey_hex.slice(0, 16)}…</dd>
                              </div>
                              <div>
                                <dt>Cert expires ~</dt>
                                <dd class="accent">{cert.cert_expiry_date}</dd>
                              </div>
                            </dl>
                            <div style={{ display: "flex", gap: "0.4rem", "margin-top": "0.5rem", "flex-wrap": "wrap" }}>
                              <button
                                type="button"
                                class="btn-secondary"
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
                                onClick={() => { removeCertFromMyBond(bond.id, cert.id); reload(); }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  {/* Add certificate inline form */}
                  <Show when={isOpen()}>
                    <div class="cert-inline" style={{ "margin-top": "0.75rem" }}>
                      <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>
                        New certificate · Bond #{bond.bond_index}
                      </p>
                      <CertSignForm
                        bondIndex={bond.bond_index}
                        bondLockDate={bond.bond_lock_date}
                        onSigned={(cert) => onSigned(bond.id, cert)}
                        onCancel={closeForm}
                      />
                    </div>
                  </Show>

                  <div class="button-row" style={{ "margin-top": "0.75rem" }}>
                    <button
                      type="button"
                      class="btn-primary"
                      onClick={() => isOpen() ? closeForm() : openForm(bond.id)}
                    >
                      {isOpen() ? "Cancel" : "+ Add Certificate"}
                    </button>
                    <a
                      href={`https://mempool.space/address/${bond.address}`}
                      target="_blank"
                      rel="noopener"
                      class="btn-secondary"
                    >
                      mempool.space ↗
                    </a>
                    <button type="button" class="btn-secondary" onClick={() => forget(bond.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Footer />
    </div>
  );
}
