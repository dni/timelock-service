import { Route, Router } from "@solidjs/router";
import BondList from "./pages/BondList";
import OrderPage from "./pages/OrderPage";

export default function App() {
  return (
    <Router>
      <Route path="/" component={BondList} />
      <Route path="/order" component={OrderPage} />
    </Router>
  );
}
