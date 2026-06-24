import { createSignal, onMount, Show } from "solid-js";
import { bech32 } from "@scure/base";
import { bytesToHex } from "@noble/hashes/utils";
import { signCertificate, signCertificateFromXprv, currentBlockPeriod, periodToApproxDate } from "./lib/certificate";
import { validateMnemonic, validateXprv } from "./lib/wallet";
import { getExtensionNpub } from "./nostr";
import type { KeyMaterial } from "./myBondHistory";
import type { Certificate } from "./lib/types";

const EXPIRY_PRESETS = [
  { label: "~3 months", periods: 6  },
  { label: "~6 months", periods: 13 },
  { label: "~1 year",   periods: 26 },
  { label: "~2 years",  periods: 52 },
];

function resolveNpub(raw: string): string {
  raw = raw.trim();
  if (raw.startsWith("npub1")) {
    const { prefix, words } = bech32.decode(raw as `${string}1${string}`, 90);
    if (prefix !== "npub") throw new Error("Not a valid npub");
    return bytesToHex(new Uint8Array(bech32.fromWords(words)));
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase();
  throw new Error("Enter a valid npub1… or 64-char hex pubkey");
}

interface Props {
  bondIndex: number;
  bondLockDate: string;
  onSigned: (cert: Certificate) => void;
  onCancel?: () => void;
  initialKeyMaterial?: KeyMaterial;
}

export default function CertSignForm(props: Props) {
  const [nostrPubkey, setNostrPubkey] = createSignal("");
  const [npubStatus, setNpubStatus] = createSignal("");
  const [expiryPreset, setExpiryPreset] = createSignal(0);
  const [keyType, setKeyType] = createSignal<"mnemonic" | "xprv">("mnemonic");
  const [keyInput, setKeyInput] = createSignal("");
  const [passphrase, setPassphrase] = createSignal("");
  const [error, setError] = createSignal("");
  const [cert, setCert] = createSignal<Certificate | null>(null);
  const [copied, setCopied] = createSignal(false);

  onMount(() => {
    const km = props.initialKeyMaterial;
    if (!km) return;
    if (km.type === "mnemonic") {
      setKeyType("mnemonic");
      setKeyInput(km.words);
      setPassphrase(km.passphrase);
    } else {
      setKeyType("xprv");
      setKeyInput(km.key);
    }
  });

  async function fillFromExtension() {
    if (!window.nostr?.getPublicKey) {
      setNpubStatus("No Nostr extension detected. Install Alby or nos2x.");
      return;
    }
    try {
      setNpubStatus("Requesting pubkey…");
      const npub = await getExtensionNpub();
      if (npub) {
        setNostrPubkey(npub);
        setNpubStatus("Pubkey loaded from extension.");
      }
    } catch {
      setNpubStatus("Extension access was not approved.");
    }
  }

  function sign(e: Event) {
    e.preventDefault();
    setError("");
    setCert(null);
    try {
      const pubkeyHex = resolveNpub(nostrPubkey());
      const expiry = currentBlockPeriod() + EXPIRY_PRESETS[expiryPreset()].periods;
      let c: Certificate;
      if (keyType() === "mnemonic") {
        const words = keyInput().trim();
        if (!validateMnemonic(words)) throw new Error("Invalid mnemonic — check word spelling and count");
        c = signCertificate(words, passphrase(), props.bondIndex, pubkeyHex, "", expiry);
      } else {
        const err = validateXprv(keyInput());
        if (err) throw new Error(err);
        c = signCertificateFromXprv(keyInput().trim(), props.bondIndex, pubkeyHex, "", expiry);
      }
      setCert(c);
      props.onSigned(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function copyJson() {
    const c = cert();
    if (!c) return;
    navigator.clipboard.writeText(JSON.stringify({
      message: c.message,
      bond_pubkey: c.bondPubkeyHex,
      cert_pubkey: c.certPubkeyHex,
      cert_expiry: c.certExpiry,
      expiry_block_height: c.expiryBlockHeight,
      expiry_approx_date: c.expiryApproxDate,
      signature: c.signatureBase64,
    }, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div>
      <form onSubmit={sign}>
        {/* ── Cert fields (mirrors WalletPage Step 3) ── */}
        <div class="field">
          <label class="label">Nostr pubkey to certify</label>
          <div style={{ display: "flex", gap: "0.5rem", "align-items": "flex-start" }}>
            <input
              class="input"
              type="text"
              placeholder="npub1… or 64-char hex"
              value={nostrPubkey()}
              onInput={(e) => setNostrPubkey(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              class="btn-secondary"
              style={{ "white-space": "nowrap", "flex-shrink": 0 }}
              onClick={fillFromExtension}
            >
              Use extension
            </button>
          </div>
          <Show when={npubStatus()}>
            <p class="field-hint muted">{npubStatus()}</p>
          </Show>
          <p class="field-hint muted">
            Bond index: {props.bondIndex} · Lock date: {props.bondLockDate}
          </p>
        </div>

        <div class="field">
          <label class="label">Certificate valid for</label>
          <select
            class="input"
            value={expiryPreset()}
            onChange={(e) => setExpiryPreset(Number(e.currentTarget.value))}
          >
            {EXPIRY_PRESETS.map((p, i) => (
              <option value={i}>
                {p.label} · expires ~{periodToApproxDate(currentBlockPeriod() + p.periods)}
              </option>
            ))}
          </select>
        </div>

        {/* ── Private key (below cert fields) ── */}
        <div class="field">
          <label class="label">Sign with</label>
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
              value={keyInput()}
              onInput={(e) => setKeyInput(e.currentTarget.value)}
            />
            <input
              class="input"
              type="password"
              placeholder="BIP39 passphrase (optional)"
              value={passphrase()}
              onInput={(e) => setPassphrase(e.currentTarget.value)}
              style={{ "margin-top": "0.5rem" }}
            />
          </Show>

          <Show when={keyType() === "xprv"}>
            <input
              class="input"
              type="password"
              placeholder="xprv… or zprv… (master or account level)"
              value={keyInput()}
              onInput={(e) => setKeyInput(e.currentTarget.value)}
            />
          </Show>
        </div>

        <Show when={error()}>
          <p class="error-text">{error()}</p>
        </Show>

        <div style={{ display: "flex", gap: "0.5rem", "flex-wrap": "wrap" }}>
          <button type="submit" class="btn-primary">Sign Certificate</button>
          <Show when={props.onCancel}>
            <button type="button" class="btn-secondary" onClick={props.onCancel}>Cancel</button>
          </Show>
        </div>
      </form>

      {/* ── Result ── */}
      <Show when={cert()}>
        {(c) => (
          <div class="generated-mnemonic" style={{ "margin-top": "1.25rem" }}>
            <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>Certificate</p>
            <dl class="stats">
              <div>
                <dt>Certified pubkey</dt>
                <dd class="mono-short accent">{c().certPubkeyHex.slice(0, 12)}…</dd>
              </div>
              <div>
                <dt>Bond pubkey</dt>
                <dd class="mono-short">{c().bondPubkeyHex.slice(0, 12)}…</dd>
              </div>
              <div>
                <dt>Expires ~</dt>
                <dd>{c().expiryApproxDate}</dd>
              </div>
              <div>
                <dt>Block period</dt>
                <dd>{c().certExpiry}</dd>
              </div>
            </dl>
            <div class="field" style={{ "margin-top": "0.75rem" }}>
              <p class="label">Signature (base64)</p>
              <code class="mono-wrap address-display" style={{ "font-size": "0.72rem" }}>
                {c().signatureBase64}
              </code>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.75rem" }}>
              <button type="button" class="btn-secondary" onClick={copyJson}>
                {copied() ? "Copied!" : "Copy JSON"}
              </button>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}
