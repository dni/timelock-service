import { createSignal, For, onMount, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { listMyBonds, removeMyBond, type SavedBond, type SavedBondCert } from "../myBondHistory";
import { publishToRelay, type NostrSignedEvent, type NostrUnsignedEvent } from "../nostr";
import Footer from "../Footer";

const DEFAULT_RELAY = "wss://relay.damus.io";

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
  const [certCopied, setCertCopied] = createSignal<string | null>(null);

  // Publish state (one cert at a time across all bonds)
  const [publishCertId, setPublishCertId] = createSignal<string | null>(null);
  const [signedEvent, setSignedEvent] = createSignal<NostrSignedEvent | null>(null);
  const [relayUrl, setRelayUrl] = createSignal(DEFAULT_RELAY);
  const [signing, setSigning] = createSignal(false);
  const [publishing, setPublishing] = createSignal(false);
  const [publishResult, setPublishResult] = createSignal("");
  const [publishError, setPublishError] = createSignal("");

  function reload() { setBonds(listMyBonds()); }
  function forget(id: string) { removeMyBond(id); reload(); }

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

  function copyCert(certId: string, cert: SavedBondCert) {
    navigator.clipboard.writeText(JSON.stringify({
      message: cert.message,
      bond_pubkey: cert.bond_pubkey_hex,
      cert_pubkey: cert.nostr_pubkey_hex,
      cert_expiry: cert.cert_expiry,
      expiry_approx_date: cert.cert_expiry_date,
      signature: cert.signature_base64,
    }, null, 2));
    setCertCopied(certId);
    setTimeout(() => setCertCopied(null), 2000);
  }

  function downloadCert(cert: SavedBondCert) {
    const data = {
      message: cert.message,
      bond_pubkey: cert.bond_pubkey_hex,
      cert_pubkey: cert.nostr_pubkey_hex,
      cert_expiry: cert.cert_expiry,
      expiry_approx_date: cert.cert_expiry_date,
      signature: cert.signature_base64,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cert-${cert.nostr_pubkey_hex.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function openPublish(certId: string) {
    setPublishCertId(certId);
    setSignedEvent(null);
    setPublishResult("");
    setPublishError("");
  }
  function closePublish() {
    setPublishCertId(null);
    setSignedEvent(null);
    setPublishResult("");
    setPublishError("");
  }

  async function handleSign(cert: SavedBondCert, bond: SavedBond) {
    if (!window.nostr?.signEvent) {
      setPublishError("No Nostr extension found. Install Alby or nos2x.");
      return;
    }
    setSigning(true);
    setPublishError("");
    try {
      const unsigned: NostrUnsignedEvent = {
        kind: 30600,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", cert.nostr_pubkey_hex],
          ["p", cert.nostr_pubkey_hex],
          ["timelock_index", String(bond.bond_index)],
          ["expiry", String(cert.cert_expiry)],
          ["cert_sig", cert.signature_base64],
        ],
        content: "",
      };
      const signed = await window.nostr.signEvent(unsigned);
      setSignedEvent(signed);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : String(err));
    } finally {
      setSigning(false);
    }
  }

  async function handlePublish() {
    const ev = signedEvent();
    if (!ev) return;
    setPublishing(true);
    setPublishResult("");
    try {
      const msg = await publishToRelay(relayUrl(), ev);
      setPublishResult("success:" + (msg || "Published"));
    } catch (err) {
      setPublishResult("error:" + (err instanceof Error ? err.message : String(err)));
    } finally {
      setPublishing(false);
    }
  }

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
              return (
                <div class="bond-card">
                  <div class="bond-card-header">
                    <h2>
                      {bond.label ? <span class="bond-label">{bond.label}</span> : null}
                      Bond #{bond.bond_index}
                    </h2>
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
                    <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.4rem" }}>
                      <button
                        type="button"
                        class="btn-secondary"
                        onClick={() => navigator.clipboard.writeText(bond.address)}
                      >
                        Copy
                      </button>
                      <a
                        href={`https://mempool.space/address/${bond.address}`}
                        target="_blank"
                        rel="noopener"
                        class="btn-secondary"
                      >
                        mempool.space ↗
                      </a>
                    </div>
                  </div>

                  {/* Certificates with actions */}
                  <Show when={bond.certs.length > 0}>
                    <div style={{ "margin-top": "0.75rem" }}>
                      <p class="card-section-title" style={{ "margin-bottom": "0.5rem" }}>
                        Certificates ({bond.certs.length})
                      </p>
                      <For each={bond.certs}>
                        {(cert) => (
                          <div class="cert-inline" style={{ "margin-bottom": "0.75rem" }}>
                            <dl class="stats">
                              <div>
                                <dt>Nostr pubkey</dt>
                                <dd class="mono-short">{cert.nostr_pubkey_hex.slice(0, 16)}…</dd>
                              </div>
                              <div>
                                <dt>Expires ~</dt>
                                <dd class="accent">{cert.cert_expiry_date}</dd>
                              </div>
                            </dl>

                            <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.5rem" }}>
                              <button
                                type="button"
                                class="btn-secondary"
                                style={{ flex: 1 }}
                                onClick={() => copyCert(cert.id, cert)}
                              >
                                {certCopied() === cert.id ? "Copied!" : "Copy"}
                              </button>
                              <button
                                type="button"
                                class="btn-secondary"
                                style={{ flex: 1 }}
                                onClick={() => downloadCert(cert)}
                              >
                                Download
                              </button>
                              <button
                                type="button"
                                class="btn-secondary"
                                style={{ flex: 1 }}
                                onClick={() =>
                                  publishCertId() === cert.id ? closePublish() : openPublish(cert.id)
                                }
                              >
                                Publish
                              </button>
                            </div>

                            {/* Inline publish flow */}
                            <Show when={publishCertId() === cert.id}>
                              <div class="cert-inline" style={{ "margin-top": "0.5rem" }}>
                                <p class="card-section-title" style={{ "margin-bottom": "0.5rem", "font-size": "0.8rem" }}>
                                  Publish NIP-600 event
                                </p>

                                <Show when={!signedEvent()}>
                                  <Show when={publishError()}>
                                    <p class="error-text" style={{ "margin-bottom": "0.5rem" }}>{publishError()}</p>
                                  </Show>
                                  <button
                                    type="button"
                                    class="btn-primary"
                                    style={{ width: "100%" }}
                                    disabled={signing()}
                                    onClick={() => handleSign(cert, bond)}
                                  >
                                    {signing() ? "Signing…" : "Sign with Nostr extension"}
                                  </button>
                                </Show>

                                <Show when={signedEvent()}>
                                  {(ev) => (
                                    <>
                                      <div class="status-pill paid" style={{ "margin-bottom": "0.75rem" }}>✓ Signed</div>
                                      <pre class="event-json">{JSON.stringify(ev(), null, 2)}</pre>
                                      <div class="field" style={{ "margin-top": "0.75rem" }}>
                                        <label class="label">Relay URL</label>
                                        <input
                                          class="input"
                                          type="url"
                                          value={relayUrl()}
                                          onInput={(e) => setRelayUrl(e.currentTarget.value)}
                                          placeholder="wss://relay.example.com"
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        class="btn-primary"
                                        style={{ width: "100%" }}
                                        disabled={publishing()}
                                        onClick={handlePublish}
                                      >
                                        {publishing() ? "Publishing…" : "Publish to relay"}
                                      </button>
                                      <Show when={publishResult()}>
                                        <p
                                          class={publishResult().startsWith("success:") ? "publish-success" : "publish-error"}
                                          style={{ "margin-top": "0.5rem" }}
                                        >
                                          {publishResult().replace(/^(success|error):/, "")}
                                        </p>
                                      </Show>
                                    </>
                                  )}
                                </Show>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.75rem" }}>
                    <button
                      type="button"
                      class="btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => navigate(`/my-bonds/${bond.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="btn-secondary"
                      style={{ flex: 1 }}
                      onClick={() => forget(bond.id)}
                    >
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
