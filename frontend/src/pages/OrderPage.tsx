import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import Footer from "../Footer";
import { getOrder, getOrderPreimage, orderStatusWebSocketUrl, requestBond, type Order } from "../api";
import { decryptCert, type CertFields } from "../crypto";
import {
  getExtensionNpub,
  pubkeyHexFromInput,
  publishToRelay,
  type NostrSignedEvent,
  type NostrUnsignedEvent,
} from "../nostr";
import { getSavedOrder, saveOrder, saveOrderPreimage } from "../orderHistory";
import QRCodeCanvas from "../QRCode";

type Step = "form" | "invoice" | "decrypt" | "done";

const DEFAULT_RELAY = "wss://relay.damus.io";

export default function OrderPage() {
  const routeParams = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const orderId = () => routeParams.id ?? "";
  const bondId = () => (searchParams.bond_id as string) ?? "";
  const bondName = () => decodeURIComponent((searchParams.bond_name as string) ?? "");

  const [step, setStep] = createSignal<Step>("form");
  const [npub, setNpub] = createSignal("");
  const [order, setOrder] = createSignal<Order | null>(null);
  const [preimage, setPreimage] = createSignal("");
  const [cert, setCert] = createSignal<CertFields | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [copied, setCopied] = createSignal("");
  const [nostrStatus, setNostrStatus] = createSignal("");
  const [signedEvent, setSignedEvent] = createSignal<NostrSignedEvent | null>(null);
  const [relayUrl, setRelayUrl] = createSignal(DEFAULT_RELAY);
  const [publishing, setPublishing] = createSignal(false);
  const [publishResult, setPublishResult] = createSignal("");
  const [savePreimage, setSavePreimage] = createSignal(false);
  const [preimageSaveStatus, setPreimageSaveStatus] = createSignal("");

  createEffect(() => {
    if (!bondId() && !orderId()) navigate("/", { replace: true });
  });

  onMount(() => {
    if (orderId()) void loadExistingOrder(orderId());
  });

  async function prefillFromNostr() {
    if (!window.nostr?.getPublicKey) {
      setNostrStatus("No Nostr extension detected. Install Alby or nos2x.");
      return;
    }
    try {
      setNostrStatus("Requesting pubkey…");
      const npub = await getExtensionNpub();
      if (npub) {
        setNpub(npub);
        setNostrStatus("Pubkey loaded from extension.");
      }
    } catch {
      setNostrStatus("Extension access was not approved.");
    }
  }

  // Imperative WebSocket — avoids reactive effect loops when the server closes the connection frequently.
  let wsClosed = false;
  let wsRef: WebSocket | null = null;

  function closeWs() {
    wsClosed = true;
    if (wsRef) { wsRef.close(); wsRef = null; }
  }

  function openWs(orderId: string) {
    closeWs();
    wsClosed = false;
    const ws = new WebSocket(orderStatusWebSocketUrl(orderId));
    wsRef = ws;

    ws.onmessage = (event) => {
      try {
        const updated = JSON.parse(event.data) as Order;
        setOrder(updated);
        if (updated.state === "PAID") {
          void savePaidPreimage(updated.order_id);
          setStep("decrypt");
          closeWs();
        } else if (updated.state === "EXPIRED") {
          setError("Invoice expired. Go back and try again.");
          closeWs();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    ws.onclose = async () => {
      if (wsClosed) return;
      // Server closed the connection — do a single HTTP check; don't reconnect.
      try {
        const updated = await getOrder(orderId);
        setOrder(updated);
        if (updated.state === "PAID") {
          await savePaidPreimage(updated.order_id);
          setStep("decrypt");
        } else if (updated.state === "EXPIRED") {
          setError("Invoice expired. Go back and try again.");
        }
      } catch {
        setError("Payment status connection closed. Refresh to check the order.");
      }
    };

    ws.onerror = () => ws.close();
  }

  onCleanup(closeWs);

  async function loadExistingOrder(id: string) {
    setError("");
    setLoading(true);
    try {
      const existing = await getOrder(id);
      setOrder(existing);
      const saved = getSavedOrder(id);
      if (saved?.preimage_hex) {
        setPreimage(saved.preimage_hex);
        setPreimageSaveStatus("Saved preimage loaded from this browser.");
      }
      if (existing.state === "PAID") {
        await savePaidPreimage(existing.order_id);
        setStep("decrypt");
      } else {
        setStep("invoice");
        openWs(existing.order_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitNpub(e: Event) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const o = await requestBond(bondId(), npub());
      saveOrder({
        order_id: o.order_id,
        bond_name: bondName(),
        created_at: Math.floor(Date.now() / 1000),
      });
      navigate(`/order/${o.order_id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function savePaidPreimage(orderId: string) {
    if (!savePreimage()) return;
    try {
      const result = await getOrderPreimage(orderId);
      setPreimage(result.preimage);
      saveOrderPreimage(orderId, result.preimage);
      setPreimageSaveStatus("Preimage saved in this browser.");
    } catch {
      setPreimageSaveStatus("Could not save preimage automatically.");
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
        err instanceof DOMException
          ? "Could not decrypt certificate with that preimage. Check that you pasted the payment preimage, not the payment hash."
          : err instanceof Error
            ? err.message
            : "Decryption failed — check preimage",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSign() {
    setError("");
    if (!window.nostr?.signEvent) {
      setError("No Nostr extension found. Install Alby or nos2x to sign events.");
      return;
    }
    setLoading(true);
    try {
      const c = cert()!;
      const beneficiaryPubkey = c.beneficiary_pubkey || order()?.beneficiary_pubkey || pubkeyHexFromInput(npub());
      const unsigned: NostrUnsignedEvent = {
        kind: 30600,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", beneficiaryPubkey],
          ["p", beneficiaryPubkey],
          ["utxo", c.utxo],
          ["timelock_index", String(c.timelock_index)],
          ["expiry", String(c.expiry)],
          ["cert_sig", c.cert_sig],
        ],
        content: "",
      };
      const signed = await window.nostr.signEvent(unsigned);
      setSignedEvent(signed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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

  function downloadCert(data: CertFields) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nip600-cert.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadEncryptedCert() {
    const o = order();
    if (!o?.encrypted_cert || !o?.cert_nonce) return;
    const data = { encrypted_cert: o.encrypted_cert, cert_nonce: o.cert_nonce, payment_hash: o.payment_hash };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nip600-cert-encrypted.json";
    a.click();
    URL.revokeObjectURL(url);
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
          <h3>Choose your Nostr identity</h3>
          <p class="muted">
            Use the Nostr key you control in your browser extension or wallet. The
            certificate is bound to this pubkey, and you will need to sign a Nostr
            event with the same key after decrypting it.
          </p>
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
            <Show when={nostrStatus()}>
              <p class="muted">{nostrStatus()}</p>
            </Show>
            <button type="button" class="btn-secondary" onClick={prefillFromNostr}>
              Use Nostr Extension Key
            </button>
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
              <QRCodeCanvas value={o().invoice.toUpperCase()} label="Lightning invoice QR code" />
              <code class="mono-wrap">{o().invoice}</code>
              <CopyBtn value={o().invoice} id="invoice" />
            </div>

            <label class="toggle-row">
              <input
                type="checkbox"
                checked={savePreimage()}
                onChange={(e) => setSavePreimage(e.currentTarget.checked)}
              />
              <span>
                Save payment preimage in this browser after payment
                <small>Off by default. Enables automatic decrypt prefill for this order.</small>
              </span>
            </label>
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
          <Show when={preimageSaveStatus()}>
            <p class="muted">{preimageSaveStatus()}</p>
          </Show>
          <Show when={order()}>
            {(o) => (
              <div class="hash-ref">
                <span class="label">Payment hash</span>
                <div class="hash-ref-row">
                  <code class="mono-wrap">{o().payment_hash}</code>
                  <CopyBtn value={o().payment_hash} id="decrypt-payment-hash" />
                </div>
              </div>
            )}
          </Show>
          <button type="button" class="btn-secondary" onClick={downloadEncryptedCert}>
            Export Certificate
          </button>
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
          <>
          <div class="card cert-card">
            <h3>Certificate Decrypted</h3>
            <p class="muted">
              Use these fields to publish your NIP-600 event. Sign the event with
              the same Nostr key you selected when creating the certificate.
            </p>

            <dl class="cert-fields">
              <div>
                <dt>
                  Beneficiary pubkey <code class="tag">p</code>
                </dt>
                <dd>
                  <span class="mono-wrap break-all">{c().beneficiary_pubkey}</span>
                  <CopyBtn value={c().beneficiary_pubkey} id="beneficiary-pubkey" />
                </dd>
              </div>
              <div>
                <dt>
                  Certificate signature <code class="tag">cert_sig</code>
                </dt>
                <dd>
                  <span class="mono-wrap break-all">{c().cert_sig}</span>
                  <CopyBtn value={c().cert_sig} id="sig" />
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

            <div class="button-row">
              <button
                type="button"
                class="btn-secondary"
                onClick={() => copy(JSON.stringify(c(), null, 2), "cert-json")}
              >
                {copied() === "cert-json" ? "Copied!" : "Copy JSON"}
              </button>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => downloadCert(c())}
              >
                Download JSON
              </button>
            </div>
          </div>

          <div class="card">
            <h3>Publish to Nostr</h3>
            <p class="muted">
              Sign this NIP-600 event with your Nostr key and broadcast it to a relay.
            </p>

            <Show when={!signedEvent()}>
              <button
                type="button"
                class="btn-primary"
                disabled={loading()}
                onClick={handleSign}
              >
                {loading() ? "Signing…" : "Sign with Nostr Extension"}
              </button>
            </Show>

            <Show when={signedEvent()}>
              {(ev) => (
                <>
                  <div class="status-pill paid" style={{ "margin-bottom": "0.75rem" }}>
                    ✓ Signed
                  </div>
                  <pre class="event-json">{JSON.stringify(ev(), null, 2)}</pre>
                  <CopyBtn value={JSON.stringify(ev())} id="event-json" />

                  <label class="field" style={{ "margin-top": "1.25rem" }}>
                    <span>Relay URL</span>
                    <input
                      type="url"
                      value={relayUrl()}
                      onInput={(e) => setRelayUrl(e.currentTarget.value)}
                      placeholder="wss://relay.example.com"
                    />
                  </label>
                  <button
                    type="button"
                    class="btn-primary"
                    disabled={publishing()}
                    onClick={handlePublish}
                  >
                    {publishing() ? "Publishing…" : "Publish to Relay"}
                  </button>
                  <Show when={publishResult()}>
                    <p
                      class={
                        publishResult().startsWith("success:")
                          ? "publish-success"
                          : "publish-error"
                      }
                    >
                      {publishResult().replace(/^(success|error):/, "")}
                    </p>
                  </Show>
                </>
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
