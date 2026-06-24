import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { decryptCert, type CertFields } from "../crypto";
import {
  pubkeyHexFromInput,
  publishToRelay,
  type NostrSignedEvent,
  type NostrUnsignedEvent,
} from "../nostr";

interface EncryptedCertFile {
  encrypted_cert: string;
  cert_nonce: string;
  payment_hash?: string;
}

type ImportState = "idle" | "encrypted" | "decrypted";

const DEFAULT_RELAY = "wss://relay.damus.io";

export default function ImportPage() {
  const navigate = useNavigate();
  const [state, setState] = createSignal<ImportState>("idle");
  const [encryptedFile, setEncryptedFile] = createSignal<EncryptedCertFile | null>(null);
  const [cert, setCert] = createSignal<CertFields | null>(null);
  const [preimage, setPreimage] = createSignal("");
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  const [signedEvent, setSignedEvent] = createSignal<NostrSignedEvent | null>(null);
  const [relayUrl, setRelayUrl] = createSignal(DEFAULT_RELAY);
  const [publishing, setPublishing] = createSignal(false);
  const [publishResult, setPublishResult] = createSignal("");
  const [copied, setCopied] = createSignal("");
  const [beneficiaryPubkey, setBeneficiaryPubkey] = createSignal("");

  function reset() {
    setState("idle");
    setEncryptedFile(null);
    setCert(null);
    setSignedEvent(null);
    setPreimage("");
    setError("");
    setPublishResult("");
    setBeneficiaryPubkey("");
  }

  function handleFile(file: File) {
    reset();
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if ("cert_sig" in json) {
          const fields = json as CertFields;
          setCert(fields);
          setBeneficiaryPubkey(fields.beneficiary_pubkey ?? "");
          setState("decrypted");
        } else if ("encrypted_cert" in json) {
          setEncryptedFile(json as EncryptedCertFile);
          setState("encrypted");
        } else {
          setError("Unrecognized certificate format.");
        }
      } catch {
        setError("Could not parse JSON file.");
      }
    };
    reader.readAsText(file);
  }

  async function handleDecrypt(e: Event) {
    e.preventDefault();
    const ef = encryptedFile();
    if (!ef) return;
    setError("");
    setLoading(true);
    try {
      const fields = await decryptCert(ef.encrypted_cert, ef.cert_nonce, preimage());
      setCert(fields);
      setBeneficiaryPubkey(fields.beneficiary_pubkey ?? "");
      setState("decrypted");
    } catch (err) {
      setError(
        err instanceof DOMException
          ? "Could not decrypt. Check that you pasted the payment preimage, not the payment hash."
          : err instanceof Error
            ? err.message
            : "Decryption failed",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleSign() {
    setError("");
    if (!window.nostr?.signEvent) {
      setError("No Nostr extension found. Install Alby or nos2x.");
      return;
    }
    setLoading(true);
    try {
      const c = cert()!;
      const beneficiary = c.beneficiary_pubkey || pubkeyHexFromInput(beneficiaryPubkey());
      const unsigned: NostrUnsignedEvent = {
        kind: 30600,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", beneficiary],
          ["p", beneficiary],
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
      <button type="button" class="btn-copy" onClick={() => copy(props.value, props.id)}>
        {copied() === props.id ? "Copied!" : "Copy"}
      </button>
    );
  }

  function monthYear(ts: number) {
    return new Date(ts * 1000).toLocaleDateString("en-US", { year: "numeric", month: "long" });
  }

  return (
    <div class="page">
      <button class="btn-back" type="button" onClick={() => navigate("/")}>← Back</button>
      <h2 class="order-title">Import Certificate</h2>

      <Show when={error()}>
        <div class="error-box"><p>{error()}</p></div>
      </Show>

      {/* File picker — always visible so user can swap files */}
      <div class="card">
        <h3>Load certificate file</h3>
        <p class="muted">Import an encrypted or decrypted NIP-600 certificate JSON.</p>
        <label class="field">
          <span>Certificate JSON</span>
          <input
            type="file"
            accept=".json,application/json"
            onInput={(e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
      </div>

      {/* Encrypted cert: show payment hash + preimage form */}
      <Show when={state() === "encrypted" && encryptedFile()}>
        {(ef) => (
          <div class="card">
            <h3>Decrypt Certificate</h3>
            <p class="muted">Enter the Lightning payment preimage to decrypt this certificate.</p>
            <Show when={ef().payment_hash}>
              <div class="hash-ref">
                <span class="label">Payment hash</span>
                <div class="hash-ref-row">
                  <code class="mono-wrap">{ef().payment_hash}</code>
                  <CopyBtn value={ef().payment_hash!} id="ph" />
                </div>
              </div>
            </Show>
            <form onSubmit={handleDecrypt}>
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
        )}
      </Show>

      {/* Decrypted cert: show fields + publish */}
      <Show when={state() === "decrypted" && cert()}>
        {(c) => (
          <>
            <div class="card cert-card">
              <h3>Certificate</h3>
              <dl class="cert-fields">
                <div>
                  <dt>Beneficiary pubkey <code class="tag">p</code></dt>
                  <dd>
                    <span class="mono-wrap break-all">{c().beneficiary_pubkey || beneficiaryPubkey()}</span>
                    <CopyBtn value={c().beneficiary_pubkey || beneficiaryPubkey()} id="beneficiary-pubkey" />
                  </dd>
                </div>
                <div>
                  <dt>Certificate signature <code class="tag">cert_sig</code></dt>
                  <dd>
                    <span class="mono-wrap break-all">{c().cert_sig}</span>
                    <CopyBtn value={c().cert_sig} id="sig" />
                  </dd>
                </div>
                <div>
                  <dt>UTXO <code class="tag">utxo</code></dt>
                  <dd>
                    <span class="mono-wrap">{c().utxo}</span>
                    <CopyBtn value={c().utxo} id="utxo" />
                  </dd>
                </div>
                <div>
                  <dt>Timelock index <code class="tag">timelock_index</code></dt>
                  <dd><span class="mono-wrap">{c().timelock_index}</span></dd>
                </div>
                <div>
                  <dt>Expiry <code class="tag">expiry</code></dt>
                  <dd>
                    <span class="mono-wrap">{c().expiry}</span>
                    <span class="muted"> ({monthYear(c().expiry)})</span>
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                class="btn-secondary"
                onClick={() => copy(JSON.stringify(c(), null, 2), "cert-json")}
              >
                {copied() === "cert-json" ? "Copied!" : "Copy JSON"}
              </button>
            </div>

            <div class="card">
              <h3>Publish to Nostr</h3>
              <p class="muted">Sign this NIP-600 event and broadcast it to a relay.</p>

              <Show when={!c().beneficiary_pubkey}>
                <label class="field">
                  <span>Beneficiary pubkey</span>
                  <input
                    type="text"
                    value={beneficiaryPubkey()}
                    onInput={(e) => setBeneficiaryPubkey(e.currentTarget.value)}
                    placeholder="npub1… or 64-char hex"
                    autocomplete="off"
                    spellcheck={false}
                  />
                </label>
              </Show>

              <Show when={!signedEvent()}>
                <button type="button" class="btn-primary" disabled={loading()} onClick={handleSign}>
                  {loading() ? "Signing…" : "Sign with Nostr Extension"}
                </button>
              </Show>

              <Show when={signedEvent()}>
                {(ev) => (
                  <>
                    <div class="status-pill paid" style={{ "margin-bottom": "0.75rem" }}>✓ Signed</div>
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
                    <button type="button" class="btn-primary" disabled={publishing()} onClick={handlePublish}>
                      {publishing() ? "Publishing…" : "Publish to Relay"}
                    </button>
                    <Show when={publishResult()}>
                      <p class={publishResult().startsWith("success:") ? "publish-success" : "publish-error"}>
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
    </div>
  );
}
