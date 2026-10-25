import { Button } from "./ui/button";
import { DRINKS, type BagState } from "./useBag";

export function Menu({ bag }: { bag: BagState }) {
  return (
    <section>
      <h1>Order ahead for pickup</h1>
      <p className="lede">Choose your drinks, then pick them up at the counter.</p>
      <ul className="menu">
        {DRINKS.map((d) => (
          <li key={d.id} className="card">
            <div>
              <h3>{d.name}</h3>
              <span className="price">${d.price.toFixed(2)}</span>
            </div>
            <Button variant="outline" onClick={() => bag.add(d.id)} aria-label={`Add ${d.name}`}>
              +
            </Button>
          </li>
        ))}
      </ul>
      {bag.count > 0 && (
        <p className="hint">
          Added to your bag
        </p>
      )}
    </section>
  );
}
