import { createSignal, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import {
  listMyBonds, addCertToMyBond, removeCertFromMyBond,
  type SavedBond, type KeyMaterial,
} from "../myBondHistory";
import CertSignForm from "../CertSignForm";
import type { Certificate } from "../lib/types";
import Footer from "../Footer";

export default function BondEditPage() {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  function loadBond(): SavedBond | null {
    return listMyBonds().find((b) => b.id === params.id) ?? null;
  }

  const [bond, setBond] = createSignal<SavedBond | null>(loadBond());

  // Signing key — pre-fill from stored key_material
  const storedKm = loadBond()?.key_material;
  const [keyType, setKeyType] = createSignal<"mnemonic" | "xprv">(
    storedKm?.type === "xprv" ? "xprv" : "mnemonic"
  );
  const [keyWords, setKeyWords] = createSignal(
    storedKm ? (storedKm.type === "mnemonic" ? storedKm.words : storedKm.key) : ""
  );
  const [keyPassphrase, setKeyPassphrase] = createSignal(
    storedKm?.type === "mnemonic" ? storedKm.passphrase : ""
  );

  const resolvedKey = (): KeyMaterial | null => {
    const w = keyWords().trim();
    if (!w) return null;
    if (keyType() === "mnemonic") return { type: "mnemonic", words: w, passphrase: keyPassphrase() };
    return { type: "xprv", key: w };
  };

  function reload() { setBond(loadBond()); }

  function removeCert(certId: string) {
    removeCertFromMyBond(params.id, certId);
    reload();
  }

  function onSigned(cert: Certificate) {
    addCertToMyBond(params.id, {
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
  }

  return (
    <div class="page">
      <button class="btn-back" type="button" onClick={() => navigate("/my-bonds")}>
        ← My Bonds
      </button>

      <Show
        when={bond()}
        fallback={<p class="muted">Bond not found.</p>}
      >
        {(b) => (
          <>
            <h2 class="order-title">
              {b().label ? <span class="bond-label">{b().label}</span> : null}
              Bond #{b().bond_index}
            </h2>

            {/* Bond details */}
            <div class="card">
              <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>Details</p>
              <dl class="stats">
                <div>
                  <dt>Locked until</dt>
                  <dd class="accent">{b().bond_lock_date}</dd>
                </div>
                <div>
                  <dt>BIP46 index</dt>
                  <dd>{b().bond_index}</dd>
                </div>
              </dl>
              <div class="field" style={{ "margin-top": "0.75rem" }}>
                <p class="label">Address</p>
                <code class="mono-wrap address-display" style={{ "font-size": "0.72rem" }}>
                  {b().address}
                </code>
                <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.4rem" }}>
                  <button
                    type="button"
                    class="btn-secondary"
                    onClick={() => navigator.clipboard.writeText(b().address)}
                  >
                    Copy address
                  </button>
                  <a
                    href={`https://mempool.space/address/${b().address}`}
                    target="_blank"
                    rel="noopener"
                    class="btn-secondary"
                  >
                    mempool.space ↗
                  </a>
                </div>
              </div>
              <div class="field" style={{ "margin-top": "0.75rem" }}>
                <p class="label">Bond public key</p>
                <code class="mono-wrap" style={{ "font-size": "0.8rem" }}>{b().pubkey_hex}</code>
              </div>
            </div>

            {/* Signing key */}
            <div class="card" style={{ "margin-top": "1.25rem" }}>
              <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>Signing key</p>
              <div class="page-tabs" style={{ "margin-bottom": "0.75rem" }}>
                <button
                  type="button"
                  class={`page-tab${keyType() === "mnemonic" ? " active" : ""}`}
                  onClick={() => setKeyType("mnemonic")}
                >Mnemonic</button>
                <button
                  type="button"
                  class={`page-tab${keyType() === "xprv" ? " active" : ""}`}
                  onClick={() => setKeyType("xprv")}
                >xprv / zprv</button>
              </div>

              <Show when={keyType() === "mnemonic"}>
                <textarea
                  class="input"
                  rows={2}
                  placeholder="12 or 24 BIP39 words"
                  value={keyWords()}
                  onInput={(e) => setKeyWords(e.currentTarget.value)}
                />
                <input
                  class="input"
                  type="password"
                  placeholder="BIP39 passphrase (optional)"
                  value={keyPassphrase()}
                  onInput={(e) => setKeyPassphrase(e.currentTarget.value)}
                  style={{ "margin-top": "0.5rem" }}
                />
              </Show>

              <Show when={keyType() === "xprv"}>
                <input
                  class="input"
                  type="password"
                  placeholder="xprv… or zprv… (master or account level)"
                  value={keyWords()}
                  onInput={(e) => setKeyWords(e.currentTarget.value)}
                />
              </Show>
            </div>

            {/* Certificate list */}
            <div class="card" style={{ "margin-top": "1.25rem" }}>
              <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>
                Certificates ({b().certs.length})
              </p>

              <Show
                when={b().certs.length > 0}
                fallback={<p class="muted" style={{ "font-size": "0.875rem" }}>No certificates yet.</p>}
              >
                <For each={b().certs}>
                  {(cert) => (
                    <div class="cert-inline" style={{ "margin-bottom": "0.75rem" }}>
                      <dl class="stats">
                        <div>
                          <dt>Nostr pubkey</dt>
                          <dd class="mono-short accent">{cert.nostr_pubkey_hex.slice(0, 16)}…</dd>
                        </div>
                        <div>
                          <dt>Expires ~</dt>
                          <dd>{cert.cert_expiry_date}</dd>
                        </div>
                      </dl>
                      <button
                        type="button"
                        class="btn-secondary"
                        style={{ width: "100%", "margin-top": "0.5rem" }}
                        onClick={() => removeCert(cert.id)}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>

            {/* Add certificate */}
            <div class="card" style={{ "margin-top": "1.25rem" }}>
              <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>Add certificate</p>
              <Show
                when={resolvedKey()}
                fallback={
                  <p class="muted" style={{ "font-size": "0.875rem" }}>
                    Enter your signing key above to add certificates.
                  </p>
                }
              >
                {(km) => (
                  <CertSignForm
                    bondIndex={b().bond_index}
                    bondLockDate={b().bond_lock_date}
                    keyMaterial={km()}
                    onSigned={onSigned}
                  />
                )}
              </Show>
            </div>
          </>
        )}
      </Show>

      <Footer />
    </div>
  );
}
