import { useEffect, useState } from "react";
import { Coffee, ShoppingBag } from "lucide-react@0.487.0";
import { Menu } from "./components/Menu";
import { Bag } from "./components/Bag";
import { Checkout } from "./components/Checkout";
import { Confirmation } from "./components/Confirmation";
import { useBag } from "./components/useBag";

function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (to: string) => {
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  };
  return [path, go];
}

export default function App() {
  const [path, go] = usePath();
  const bag = useBag();
  return (
    <div className="shell">
      <header className="top">
        <button className="brand" onClick={() => go("/")}>
          <Coffee size={20} aria-hidden="true" />
          <span>Northwind Coffee</span>
        </button>
        <button className="bag-icon" aria-label="Bag" onClick={() => go("/bag")}>
          <ShoppingBag size={20} aria-hidden="true" />
          {bag.count > 0 && <span className="dot">{bag.count}</span>}
        </button>
      </header>
      <main>
        {path === "/" && <Menu bag={bag} />}
        {path === "/bag" && <Bag bag={bag} go={go} />}
        {path === "/checkout" && <Checkout bag={bag} go={go} />}
        {path === "/order/confirmed" && <Confirmation />}
        {!["/", "/bag", "/checkout", "/order/confirmed"].includes(path) && <p className="empty">Page not found.</p>}
      </main>
    </div>
  );
}
