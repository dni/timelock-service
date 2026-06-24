import { Route, Router } from "@solidjs/router";
import type { RouteSectionProps } from "@solidjs/router";
import Nav from "./Nav";
import BondList from "./pages/BondList";
import BondsPage from "./pages/BondsPage";
import CertificatesPage from "./pages/CertificatesPage";
import ImportPage from "./pages/ImportPage";
import MyBondsPage from "./pages/MyBondsPage";
import OrderPage from "./pages/OrderPage";
import WalletPage from "./pages/WalletPage";

function Layout(props: RouteSectionProps) {
  return (
    <>
      <Nav />
      {props.children}
    </>
  );
}

export default function App() {
  return (
    <Router>
      <Route path="/" component={Layout}>
        <Route path="/" component={BondList} />
        <Route path="/bonds" component={BondsPage} />
        <Route path="/order/new" component={OrderPage} />
        <Route path="/order/:id" component={OrderPage} />
        <Route path="/certificates" component={CertificatesPage} />
        <Route path="/my-bonds" component={MyBondsPage} />
        <Route path="/import" component={ImportPage} />
        <Route path="/wallet" component={WalletPage} />
      </Route>
    </Router>
  );
}
