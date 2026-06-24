import { A } from "@solidjs/router";

export default function Nav() {
  return (
    <>
      <div class="alpha-banner">
        ⚠ Alpha — do not use real funds
      </div>
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
