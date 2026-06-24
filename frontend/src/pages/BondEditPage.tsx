import { createSignal, For, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import {
  listMyBonds, addCertToMyBond, removeCertFromMyBond,
  type SavedBond,
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
  const [certCopied, setCertCopied] = createSignal<string | null>(null);

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

  function copyCert(certId: string, data: object) {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCertCopied(certId);
    setTimeout(() => setCertCopied(null), 2000);
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
            <h2 class="order-title">Bond #{b().bond_index}</h2>

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
                      <div style={{ display: "flex", gap: "0.4rem", "margin-top": "0.5rem", "flex-wrap": "wrap" }}>
                        <button
                          type="button"
                          class="btn-secondary"
                          onClick={() =>
                            copyCert(cert.id, {
                              message: cert.message,
                              bond_pubkey: cert.bond_pubkey_hex,
                              cert_pubkey: cert.nostr_pubkey_hex,
                              cert_expiry: cert.cert_expiry,
                              expiry_approx_date: cert.cert_expiry_date,
                              signature: cert.signature_base64,
                            })
                          }
                        >
                          {certCopied() === cert.id ? "Copied!" : "Copy JSON"}
                        </button>
                        <button
                          type="button"
                          class="btn-secondary"
                          onClick={() => removeCert(cert.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>

            {/* Add certificate */}
            <div class="card" style={{ "margin-top": "1.25rem" }}>
              <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>Add certificate</p>
              <CertSignForm
                bondIndex={b().bond_index}
                bondLockDate={b().bond_lock_date}
                initialKeyMaterial={b().key_material}
                onSigned={onSigned}
              />
            </div>
          </>
        )}
      </Show>

      <Footer />
    </div>
  );
}
