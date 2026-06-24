import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import { getOrder, requestBond, type Order } from "../api";
import { decryptCert, type CertFields } from "../crypto";

type Step = "form" | "invoice" | "decrypt" | "done";

export default function OrderPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const bondId = () => (params.bond_id as string) ?? "";
  const bondName = () => decodeURIComponent((params.bond_name as string) ?? "");

  const [step, setStep] = createSignal<Step>("form");
  const [npub, setNpub] = createSignal("");
  const [order, setOrder] = createSignal<Order | null>(null);
  const [preimage, setPreimage] = createSignal("");
  const [cert, setCert] = createSignal<CertFields | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [copied, setCopied] = createSignal("");

  createEffect(() => {
    if (!bondId()) navigate("/");
  });

  // Poll every 3 seconds while waiting for payment
  createEffect(() => {
    if (step() !== "invoice") return;
    const o = order();
    if (!o) return;

    const id = setInterval(async () => {
      try {
        const updated = await getOrder(o.order_id);
        setOrder(updated);
        if (updated.state === "PAID") {
          setStep("decrypt");
        } else if (updated.state === "EXPIRED") {
          setError("Invoice expired. Go back and try again.");
        }
      } catch {
        // transient errors are fine during polling
      }
    }, 3000);

    onCleanup(() => clearInterval(id));
  });

  async function submitNpub(e: Event) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const o = await requestBond(bondId(), npub());
      setOrder(o);
      setStep("invoice");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitPreimage(e: Event) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const o = order()!;
      if (!o.encrypted_cert || !o.cert_nonce)
        throw new Error("No certificate data on order");
      const fields = await decryptCert(o.encrypted_cert, o.cert_nonce, preimage());
      setCert(fields);
      setStep("done");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Decryption failed — check preimage",
      );
    } finally {
      setLoading(false);
    }
  }

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(""), 1500);
  }

  function CopyBtn(props: { value: string; id: string }) {
    return (
      <button
        type="button"
        class="btn-copy"
        onClick={() => copy(props.value, props.id)}
      >
        {copied() === props.id ? "Copied!" : "Copy"}
      </button>
    );
  }

  function monthYear(ts: number) {
    return new Date(ts * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
    });
  }

  return (
    <div class="page">
      <button class="btn-back" type="button" onClick={() => navigate("/")}>
        ← Back
      </button>

      <Show when={bondName()}>
        <h2 class="order-title">{bondName()}</h2>
      </Show>

      <Show when={error()}>
        <div class="error-box">
          <p>{error()}</p>
        </div>
      </Show>

      {/* ── Step 1: Enter npub ── */}
      <Show when={step() === "form"}>
        <div class="card">
          <h3>Enter your Nostr pubkey</h3>
          <p class="muted">The certificate will be cryptographically bound to this identity.</p>
          <form onSubmit={submitNpub}>
            <label class="field">
              <span>Nostr pubkey</span>
              <input
                type="text"
                value={npub()}
                onInput={(e) => setNpub(e.currentTarget.value)}
                placeholder="npub1… or 64-char hex"
                autocomplete="off"
                spellcheck={false}
                required
              />
            </label>
            <button type="submit" class="btn-primary" disabled={loading()}>
              {loading() ? "Creating invoice…" : "Continue"}
            </button>
          </form>
        </div>
      </Show>

      {/* ── Step 2: Pay invoice ── */}
      <Show when={step() === "invoice" && order()}>
        {(o) => (
          <div class="card">
            <h3>Pay Lightning Invoice</h3>
            <div class="status-pill pending">⏳ Waiting for payment…</div>

            <dl class="stats">
              <div>
                <dt>Amount due</dt>
                <dd class="accent">{o().price_sats.toLocaleString()} sats</dd>
              </div>
              <div>
                <dt>Bond value (your share)</dt>
                <dd>{o().bond_sats.toLocaleString()} sats</dd>
              </div>
              <div>
                <dt>Timelocked until</dt>
                <dd>{monthYear(o().bond_expiry)}</dd>
              </div>
            </dl>

            <div class="invoice-block">
              <p class="label">Lightning Invoice</p>
              <code class="mono-wrap">{o().invoice}</code>
              <CopyBtn value={o().invoice} id="invoice" />
            </div>

            <div class="invoice-block">
              <p class="label">LNURL</p>
              <code class="mono-wrap">{o().lnurl}</code>
              <CopyBtn value={o().lnurl} id="lnurl" />
            </div>

            <Show when={o().lightning_address}>
              <div class="invoice-block">
                <p class="label">Lightning Address</p>
                <code class="mono-wrap">{o().lightning_address}</code>
                <CopyBtn value={o().lightning_address!} id="lna" />
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* ── Step 3: Enter preimage ── */}
      <Show when={step() === "decrypt"}>
        <div class="card">
          <h3>Payment confirmed</h3>
          <div class="status-pill paid">✓ Paid</div>
          <p class="muted">
            Enter the Lightning payment preimage from your wallet to decrypt your
            certificate. It's 64 hex characters — check your wallet's payment
            receipt or history.
          </p>
          <form onSubmit={submitPreimage}>
            <label class="field">
              <span>Payment preimage (64 hex chars)</span>
              <input
                type="text"
                value={preimage()}
                onInput={(e) => setPreimage(e.currentTarget.value)}
                placeholder="0000…0000"
                pattern="[0-9a-fA-F]{64}"
                autocomplete="off"
                spellcheck={false}
                required
              />
            </label>
            <button type="submit" class="btn-primary" disabled={loading()}>
              {loading() ? "Decrypting…" : "Decrypt Certificate"}
            </button>
          </form>
        </div>
      </Show>

      {/* ── Step 4: Show certificate ── */}
      <Show when={step() === "done" && cert()}>
        {(c) => (
          <div class="card cert-card">
            <h3>Certificate Decrypted</h3>
            <p class="muted">
              Use these fields to publish your NIP-600 event. Sign it with your
              own Nostr key.
            </p>

            <dl class="cert-fields">
              <div>
                <dt>
                  Bond signature <code class="tag">bond_sig</code>
                </dt>
                <dd>
                  <span class="mono-wrap break-all">{c().bond_sig}</span>
                  <CopyBtn value={c().bond_sig} id="sig" />
                </dd>
              </div>
              <div>
                <dt>
                  Account xpub <code class="tag">xpub</code>
                </dt>
                <dd>
                  <span class="mono-wrap break-all">{c().xpub}</span>
                  <CopyBtn value={c().xpub} id="xpub" />
                </dd>
              </div>
              <div>
                <dt>
                  UTXO <code class="tag">utxo</code>
                </dt>
                <dd>
                  <span class="mono-wrap">{c().utxo}</span>
                  <CopyBtn value={c().utxo} id="utxo" />
                </dd>
              </div>
              <div>
                <dt>
                  Timelock index <code class="tag">timelock_index</code>
                </dt>
                <dd>
                  <span class="mono-wrap">{c().timelock_index}</span>
                </dd>
              </div>
              <div>
                <dt>
                  Expiry <code class="tag">expiry</code>
                </dt>
                <dd>
                  <span class="mono-wrap">{c().expiry}</span>
                  <span class="muted"> ({monthYear(c().expiry)})</span>
                </dd>
              </div>
            </dl>

            <button
              type="button"
              class="btn-secondary"
              onClick={() =>
                copy(JSON.stringify(c(), null, 2), "cert-json")
              }
            >
              {copied() === "cert-json" ? "Copied!" : "Copy JSON"}
            </button>
          </div>
        )}
      </Show>
    </div>
  );
}
