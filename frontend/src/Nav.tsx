import { A } from "@solidjs/router";
import { createSignal } from "solid-js";

export default function Nav() {
  const [bannerVisible, setBannerVisible] = createSignal(true);

  return (
    <>
      {bannerVisible() && (
        <div class="alpha-banner">
          ⚠ Alpha — do not use real funds
          <button class="alpha-banner-close" onClick={() => setBannerVisible(false)} aria-label="Dismiss">✕</button>
        </div>
      )}
      <nav class="main-nav">
        <div class="main-nav-inner">
          <A href="/" class="nav-brand">
            Timelock
            <span class="alpha-badge">ALPHA</span>
          </A>
          <div class="nav-links">
            <A href="/bonds" class="nav-link" activeClass="nav-link--active">Bonds</A>
            <A href="/certificates" class="nav-link" activeClass="nav-link--active">Certificates</A>
            <A href="/my-bonds" class="nav-link" activeClass="nav-link--active">My Bonds</A>
          </div>
        </div>
      </nav>
    </>
  );
}
