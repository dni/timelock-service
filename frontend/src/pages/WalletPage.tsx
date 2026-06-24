import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { bech32 } from "@scure/base";
import { bytesToHex } from "@noble/hashes/utils";
import Footer from "../Footer";
import { deriveBonds, deriveBondsFromXpub, deriveBondFromXprv } from "../lib/timelock";
import { generateMnemonic, validateMnemonic, validateXpub, validateXprv } from "../lib/wallet";
import { signCertificate, signCertificateFromXprv, currentBlockPeriod, periodToApproxDate } from "../lib/certificate";
import { saveMyBond, type SavedBond } from "../myBondHistory";
import type { TimelockBond, Certificate } from "../lib/types";

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 16 }, (_, i) => 2020 + i); // 2020–2035

function dateToIndex(year: number, month: number): number {
  return (year - 2020) * 12 + (month - 1);
}

export default function WalletPage() {
  const navigate = useNavigate();

  const [genWords, setGenWords] = createSignal<12 | 24>(12);
  const [generatedMnemonic, setGeneratedMnemonic] = createSignal("");
  const [genCopied, setGenCopied] = createSignal(false);

  function generate() {
    setGeneratedMnemonic(generateMnemonic(genWords()));
    setGenCopied(false);
  }

  function useGenerated() {
    setMnemonic(generatedMnemonic());
    setTab("mnemonic");
  }

  function copyGenerated() {
    navigator.clipboard.writeText(generatedMnemonic());
    setGenCopied(true);
    setTimeout(() => setGenCopied(false), 2000);
  }

  const [tab, setTab] = createSignal<"mnemonic" | "xpub" | "xprv">("mnemonic");
  const [mnemonic, setMnemonic] = createSignal("");
  const [passphrase, setPassphrase] = createSignal("");
  const [xpub, setXpub] = createSignal("");
  const [xprv, setXprv] = createSignal("");
  const [year, setYear] = createSignal(THIS_YEAR + 1);
  const [month, setMonth] = createSignal(1);
  const [bond, setBond] = createSignal<TimelockBond | null>(null);
  const [error, setError] = createSignal("");
  const [showScript, setShowScript] = createSignal(false);

  // bond save state (persists across Step 3)
  const [savedBondId, setSavedBondId] = createSignal<string | null>(null);
  const [bondSaved, setBondSaved] = createSignal(false);

  function makeSavedBond(b: TimelockBond): SavedBond {
    const id = savedBondId() ?? crypto.randomUUID();
    setSavedBondId(id);
    return {
      id,
      created_at: Math.floor(Date.now() / 1000),
      address: b.address,
      bond_index: b.index,
      bond_lock_date: b.timelockDate,
      timelock_ts: b.timelockTs,
      pubkey_hex: b.pubkeyHex,
      witness_script_hex: b.witnessScriptHex,
    };
  }

  function saveBondOnly() {
    const b = bond();
    if (!b) return;
    saveMyBond(makeSavedBond(b));
    setBondSaved(true);
  }

  // Step 3 — certificate
  const EXPIRY_PRESETS = [
    { label: "~3 months",  periods: 6  },
    { label: "~6 months",  periods: 13 },
    { label: "~1 year",    periods: 26 },
    { label: "~2 years",   periods: 52 },
  ];
  const [nostrPubkey, setNostrPubkey] = createSignal("");
  const [expiryPreset, setExpiryPreset] = createSignal(0);
  const [cert, setCert] = createSignal<Certificate | null>(null);
  const [certError, setCertError] = createSignal("");
  const [certCopied, setCertCopied] = createSignal(false);
  const [certSaved, setCertSaved] = createSignal(false);

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

  function signCert(e: Event) {
    e.preventDefault();
    setCertError("");
    setCert(null);
    setCertSaved(false);
    const b = bond();
    if (!b) return;
    try {
      const pubkeyHex = resolveNpub(nostrPubkey());
      const expiry = currentBlockPeriod() + EXPIRY_PRESETS[expiryPreset()].periods;
      let c: Certificate;
      if (tab() === "mnemonic") {
        const words = mnemonic().trim();
        if (!validateMnemonic(words)) throw new Error("Invalid mnemonic");
        c = signCertificate(words, passphrase(), b.index, pubkeyHex, "", expiry);
      } else if (tab() === "xprv") {
        c = signCertificateFromXprv(xprv().trim(), b.index, pubkeyHex, "", expiry);
      } else {
        throw new Error("Certificate signing requires a private key (use Mnemonic or xprv/zprv tab)");
      }
      setCert(c);
    } catch (err) {
      setCertError(err instanceof Error ? err.message : String(err));
    }
  }

  function saveCert() {
    const b = bond();
    const c = cert();
    if (!b || !c) return;
    const base = makeSavedBond(b);
    saveMyBond({
      ...base,
      cert: {
        nostr_pubkey_hex: c.certPubkeyHex,
        bond_pubkey_hex: c.bondPubkeyHex,
        cert_expiry: c.certExpiry,
        cert_expiry_date: c.expiryApproxDate,
        message: c.message,
        signature_base64: c.signatureBase64,
      },
    });
    setBondSaved(true);
    setCertSaved(true);
  }

  function copyCertJson() {
    const c = cert();
    if (!c) return;
    const json = JSON.stringify({
      message: c.message,
      bond_pubkey: c.bondPubkeyHex,
      cert_pubkey: c.certPubkeyHex,
      cert_expiry: c.certExpiry,
      expiry_block_height: c.expiryBlockHeight,
      expiry_approx_date: c.expiryApproxDate,
      signature: c.signatureBase64,
    }, null, 2);
    navigator.clipboard.writeText(json);
    setCertCopied(true);
    setTimeout(() => setCertCopied(false), 2000);
  }

  const index = () => dateToIndex(year(), month());

  function derive(e: Event) {
    e.preventDefault();
    setError("");
    setBond(null);
    setBondSaved(false);
    setSavedBondId(null);
    setCert(null);
    setCertSaved(false);
    try {
      const idx = index();
      if (idx < 0 || idx > 959) throw new Error("Date out of BIP46 range (2020–2099)");

      if (tab() === "mnemonic") {
        const words = mnemonic().trim();
        if (!validateMnemonic(words)) throw new Error("Invalid mnemonic — check word spelling and count");
        const [b] = deriveBonds(words, passphrase(), idx, idx);
        setBond(b);
      } else if (tab() === "xpub") {
        const key = xpub().trim();
        const err = validateXpub(key);
        if (err) throw new Error(err);
        const [b] = deriveBondsFromXpub(key, idx, idx);
        setBond(b);
      } else {
        const key = xprv().trim();
        const err = validateXprv(key);
        if (err) throw new Error(err);
        setBond(deriveBondFromXprv(key, idx));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div class="page">
      <button class="btn-back" type="button" onClick={() => navigate("/")}>← Back</button>

      <h2 class="order-title">Create Your Own Bond</h2>
      <p class="muted" style={{ "margin-bottom": "1.75rem" }}>
        Derive a BIP46 timelocked address from your own keys.
        Your seed phrase never leaves this browser.
      </p>

      <div class="card generate-card">
        <p class="card-section-title" style={{ "margin-bottom": "0.75rem" }}>Step 1 — Generate a seed phrase</p>
        <p class="muted" style={{ "margin-bottom": "1rem", "font-size": "0.875rem" }}>
          Skip this if you already have a seed phrase, xprv, or zprv.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" }}>
          <div class="wordcount-toggle">
            <button
              type="button"
              class={`wordcount-btn${genWords() === 12 ? " active" : ""}`}
              onClick={() => setGenWords(12)}
            >12 words</button>
            <button
              type="button"
              class={`wordcount-btn${genWords() === 24 ? " active" : ""}`}
              onClick={() => setGenWords(24)}
            >24 words</button>
          </div>
          <button type="button" class="btn-secondary" onClick={generate}>
            Generate
          </button>
        </div>

        <Show when={generatedMnemonic()}>
          <div class="generated-mnemonic">
            <p class="generated-mnemonic-words">{generatedMnemonic()}</p>
            <p class="field-hint muted" style={{ "margin-top": "0.5rem" }}>
              Write this down and store it safely. It cannot be recovered.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.75rem" }}>
              <button type="button" class="btn-secondary" onClick={copyGenerated}>
                {genCopied() ? "Copied!" : "Copy"}
              </button>
              <button type="button" class="btn-primary" onClick={useGenerated}>
                Use this →
              </button>
            </div>
          </div>
        </Show>
      </div>

      <div class="card" style={{ "margin-top": "1.25rem" }}>
        <p class="card-section-title" style={{ "margin-bottom": "1rem" }}>Step 2 — Derive your bond address</p>
        <div class="page-tabs" style={{ "margin-bottom": "1.25rem" }}>
          <button
            type="button"
            class={`page-tab${tab() === "mnemonic" ? " active" : ""}`}
            onClick={() => setTab("mnemonic")}
          >
            Mnemonic
          </button>
          <button
            type="button"
            class={`page-tab${tab() === "xpub" ? " active" : ""}`}
            onClick={() => setTab("xpub")}
          >
            xpub / zpub
          </button>
          <button
            type="button"
            class={`page-tab${tab() === "xprv" ? " active" : ""}`}
            onClick={() => setTab("xprv")}
          >
            xprv / zprv
          </button>
        </div>

        <form onSubmit={derive}>
          <Show when={tab() === "mnemonic"}>
            <div class="field">
              <label class="label">Seed phrase</label>
              <textarea
                class="input"
                rows={3}
                placeholder="12 or 24 BIP39 words separated by spaces"
                value={mnemonic()}
                onInput={(e) => setMnemonic(e.currentTarget.value)}
              />
            </div>
            <div class="field">
              <label class="label">Passphrase <span class="muted">(optional)</span></label>
              <input
                class="input"
                type="password"
                placeholder="BIP39 passphrase"
                value={passphrase()}
                onInput={(e) => setPassphrase(e.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={tab() === "xpub"}>
            <div class="field">
              <label class="label">Account xpub <span class="muted">(m/84'/0'/0')</span></label>
              <input
                class="input"
                type="text"
                placeholder="xpub… or zpub…"
                value={xpub()}
                onInput={(e) => setXpub(e.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={tab() === "xprv"}>
            <div class="field">
              <label class="label">Private extended key</label>
              <input
                class="input"
                type="password"
                placeholder="xprv… or zprv… (master or account level)"
                value={xprv()}
                onInput={(e) => setXprv(e.currentTarget.value)}
              />
              <p class="field-hint muted">
                Accepts master (depth 0) or account-level (depth 3, m/84'/0'/0') keys.
              </p>
            </div>
          </Show>

          <div class="field">
            <label class="label">Lock until</label>
            <div class="date-row">
              <select
                class="input"
                value={month()}
                onChange={(e) => setMonth(Number(e.currentTarget.value))}
              >
                {MONTHS.map((m, i) => (
                  <option value={i + 1}>{m}</option>
                ))}
              </select>
              <select
                class="input"
                value={year()}
                onChange={(e) => setYear(Number(e.currentTarget.value))}
              >
                {YEARS.map((y) => (
                  <option value={y}>{y}</option>
                ))}
              </select>
            </div>
            <p class="field-hint muted">BIP46 index: {index()}</p>
          </div>

          <Show when={error()}>
            <p class="error-text">{error()}</p>
          </Show>

          <button type="submit" class="btn-primary">Derive Address</button>
        </form>
      </div>

      <Show when={bond()}>
        {(b) => (
          <div class="card" style={{ "margin-top": "1.25rem" }}>
            <h3 class="card-section-title">Timelocked Address</h3>

            <dl class="stats">
              <div>
                <dt>Lock date</dt>
                <dd class="accent">{b().timelockDate}</dd>
              </div>
              <div>
                <dt>BIP46 index</dt>
                <dd>{b().index}</dd>
              </div>
              <div>
                <dt>Locktime (Unix)</dt>
                <dd>{b().timelockTs}</dd>
              </div>
            </dl>

            <div class="field" style={{ "margin-top": "1rem" }}>
              <p class="label">P2WSH Address</p>
              <code class="mono-wrap address-display">{b().address}</code>
              <button
                type="button"
                class="btn-secondary"
                style={{ "margin-top": "0.5rem" }}
                onClick={() => navigator.clipboard.writeText(b().address)}
              >
                Copy Address
              </button>
            </div>

            <div class="field" style={{ "margin-top": "1rem" }}>
              <p class="label">Bond Public Key</p>
              <code class="mono-wrap">{b().pubkeyHex}</code>
            </div>

            <details onToggle={(e) => setShowScript((e.currentTarget as HTMLDetailsElement).open)}>
              <summary class="faq-question" style={{ "font-size": "0.85rem" }}>
                Witness script hex
              </summary>
              <code class="mono-wrap" style={{ "margin-top": "0.5rem", display: "block", "font-size": "0.72rem" }}>
                {b().witnessScriptHex}
              </code>
            </details>

            <div style={{ display: "flex", gap: "0.5rem", "margin-top": "1rem", "flex-wrap": "wrap" }}>
              <button
                type="button"
                class={bondSaved() ? "btn-secondary" : "btn-primary"}
                disabled={bondSaved()}
                onClick={saveBondOnly}
              >
                {bondSaved() ? "Bond saved ✓" : "Save Bond"}
              </button>
              <Show when={bondSaved()}>
                <button type="button" class="btn-secondary" onClick={() => navigate("/my-bonds")}>
                  View in My Bonds →
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>

      <Show when={bond()}>
        {(b) => (
          <div class="card" style={{ "margin-top": "1.25rem" }}>
            <p class="card-section-title" style={{ "margin-bottom": "1rem" }}>Step 3 — Create a certificate</p>
            <p class="muted" style={{ "margin-bottom": "1rem", "font-size": "0.875rem" }}>
              Sign a certificate tying a Nostr pubkey to this bond. The bond's private key signs the cert.
            </p>

            <Show when={tab() === "xpub"}>
              <p class="error-text" style={{ "margin-bottom": "1rem" }}>
                Certificate signing requires a private key — switch to the Mnemonic or xprv/zprv tab.
              </p>
            </Show>

            <form onSubmit={signCert}>
              <div class="field">
                <label class="label">Nostr pubkey to certify</label>
                <input
                  class="input"
                  type="text"
                  placeholder="npub1… or 64-char hex"
                  value={nostrPubkey()}
                  onInput={(e) => setNostrPubkey(e.currentTarget.value)}
                />
                <p class="field-hint muted">Bond index: {b().index} · Lock date: {b().timelockDate}</p>
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

              <Show when={certError()}>
                <p class="error-text">{certError()}</p>
              </Show>

              <button type="submit" class="btn-primary" disabled={tab() === "xpub"}>
                Sign Certificate
              </button>
            </form>

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
                  <div style={{ display: "flex", gap: "0.5rem", "margin-top": "0.75rem", "flex-wrap": "wrap" }}>
                    <button type="button" class="btn-secondary" onClick={copyCertJson}>
                      {certCopied() ? "Copied!" : "Copy JSON"}
                    </button>
                    <button
                      type="button"
                      class={certSaved() ? "btn-secondary" : "btn-primary"}
                      onClick={saveCert}
                      disabled={certSaved()}
                    >
                      {certSaved() ? "Saved ✓" : "Save to My Bonds"}
                    </button>
                    <Show when={certSaved()}>
                      <button
                        type="button"
                        class="btn-secondary"
                        onClick={() => navigate("/my-bonds")}
                      >
                        View in My Bonds →
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Footer />
    </div>
  );
}
