import { createResource, createSignal, onCleanup, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchBonds } from "../api";
import Footer from "../Footer";

const FAQ = [
  {
    q: "How does Timelock work?",
    a: "We lock Bitcoin on-chain in a timelocked UTXO on your behalf. You pay a small fee via Lightning, and we issue you a signed NIP-600 certificate tied to your Nostr pubkey. Present that certificate to bond-gated relays and publish freely for the duration of the lock.",
  },
  {
    q: "What do you charge?",
    a: "A one-time service fee on the bond value, paid via Lightning when you claim your certificate slot. The fee covers our capital opportunity cost and operational overhead. The exact fee is shown on each bond before you pay.",
  },
  {
    q: "Do I need to own Bitcoin?",
    a: "No. We provide the locked capital. You only pay our Lightning fee — typically a small fraction of the bond value. You never touch on-chain Bitcoin yourself.",
  },
  {
    q: "How is my certificate delivered?",
    a: "The certificate is AES-encrypted with your Lightning payment preimage as the key and delivered immediately on payment. Only you can decrypt it — we never see your preimage after the invoice is paid. Save your preimage; it's your only decryption key.",
  },
  {
    q: "Is the Bitcoin really locked?",
    a: "Yes. The funds sit in a BIP46 timelocked P2WSH output on the Bitcoin blockchain. The timelock is enforced at the consensus layer — not even we can spend the output before it expires. Any relay can verify this directly on-chain.",
  },
  {
    q: "What if Timelock goes offline?",
    a: "Your certificate is self-contained and already cryptographically signed. Relays verify it against the Bitcoin blockchain directly — our servers are not in that path. A certificate issued today remains valid until its expiry regardless of our uptime.",
  },
  {
    q: "How long is the lock period?",
    a: "Each bond listing shows its lock expiry date. We offer bonds with multi-month to multi-year timelocks. Longer locks carry more anti-spam weight per sat and are priced accordingly.",
  },
  {
    q: "Can I get a refund?",
    a: "No. Once a certificate is issued the capital is committed on-chain and cannot be recalled before the timelock expires. This is by design — the irreversibility is what makes the bond credible to relays.",
  },
];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatBtc(sats: number) {
  return (sats / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
}

export default function BondList() {
  const navigate = useNavigate();
  const [bonds] = createResource(fetchBonds);
  const [now, setNow] = createSignal(Date.now());

  const ticker = setInterval(() => setNow(Date.now()), 1000);
  onCleanup(() => clearInterval(ticker));

  const totalSats = () =>
    (bonds() ?? [])
      .filter((b) => b.status === "AVAILABLE")
      .reduce((sum, b) => sum + b.bond_sats, 0);

  const latestExpiry = () =>
    Math.max(0, ...(bonds() ?? []).map((b) => b.timelock_expiry));

  const countdown = () => {
    const diff = Math.max(0, latestExpiry() * 1000 - now());
    return {
      days:  Math.floor(diff / 86_400_000),
      hours: Math.floor((diff % 86_400_000) / 3_600_000),
      mins:  Math.floor((diff % 3_600_000) / 60_000),
      secs:  Math.floor((diff % 60_000) / 1_000),
    };
  };

  return (
    <div class="page">
      <section class="hero">
        <p class="hero-eyebrow">Fidelity Bond Provider</p>
        <h2 class="hero-headline">
          Lock Bitcoin.<br />Post freely.
        </h2>
        <p class="hero-body">
          Fidelity bonds let you prove skin-in-the-game to Nostr relays
          without spending a sat. Lock Bitcoin for a fixed period, get a
          certificate over Lightning, and publish without per-event friction.
        </p>

        <Show when={!bonds.loading && (bonds() ?? []).length > 0}>
          <div class="lockbox">
            <p class="lockbox-label">funds locked for</p>
            <div class="lockbox-timer">
              <div class="lockbox-unit">
                <span class="lockbox-digit">{countdown().days}</span>
                <span class="lockbox-unit-label">days</span>
              </div>
              <span class="lockbox-sep">:</span>
              <div class="lockbox-unit">
                <span class="lockbox-digit">{pad(countdown().hours)}</span>
                <span class="lockbox-unit-label">hours</span>
              </div>
              <span class="lockbox-sep">:</span>
              <div class="lockbox-unit">
                <span class="lockbox-digit">{pad(countdown().mins)}</span>
                <span class="lockbox-unit-label">min</span>
              </div>
              <span class="lockbox-sep">:</span>
              <div class="lockbox-unit">
                <span class="lockbox-digit lockbox-digit--secs">{pad(countdown().secs)}</span>
                <span class="lockbox-unit-label">sec</span>
              </div>
            </div>
            <p class="lockbox-amount">{formatBtc(totalSats())} BTC locked on-chain</p>
          </div>
        </Show>

        <div class="hero-actions">
          <button type="button" class="btn-hero" onClick={() => navigate("/bonds")}>
            Browse Bonds →
          </button>
          <a
            class="btn-hero-secondary"
            href="https://dni.github.io/timelock-wallet/"
            target="_blank"
            rel="noopener"
          >
            Create your own
          </a>
        </div>

        <div class="hero-pillars">
          <div class="hero-pillar">
            <span class="hero-pillar-icon">⚡</span>
            <strong>Pay once via Lightning</strong>
            <span>Certificate delivered encrypted with your payment preimage</span>
          </div>
          <div class="hero-pillar">
            <span class="hero-pillar-icon">🔒</span>
            <strong>Bitcoin locked, not spent</strong>
            <span>We lock our Bitcoin so you don't have to.</span>
          </div>
          <div class="hero-pillar">
            <span class="hero-pillar-icon">📜</span>
            <strong>One cert, unlimited posts</strong>
            <span>No per-event cost for the full duration of the bond</span>
          </div>
        </div>
      </section>

      <section class="faq">
        <h2 class="faq-title">Frequently Asked Questions</h2>
        <div class="faq-list">
          {FAQ.map((item) => (
            <details class="faq-item">
              <summary class="faq-question">{item.q}</summary>
              <p class="faq-answer">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <Footer />
    </div>
  );
}
