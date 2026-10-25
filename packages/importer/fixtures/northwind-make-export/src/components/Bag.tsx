import { Button } from "./ui/button";
import { DRINKS, type BagState } from "./useBag";

export function Bag({ bag, go }: { bag: BagState; go: (to: string) => void }) {
  if (bag.count === 0) {
    return (
      <section>
        <h1>Your bag</h1>
        <p className="empty">Your bag is empty.</p>
        <Button onClick={() => go("/")}>Browse the menu</Button>
      </section>
    );
  }
  return (
    <section>
      <h1>Your bag</h1>
      <ul className="lines">
        {bag.items.map((id, i) => {
          const d = DRINKS.find((x) => x.id === id)!;
          return (
            <li key={`${id}-${i}`}>
              <span>{d.name}</span>
              <span>${d.price.toFixed(2)}</span>
              <button className="link" onClick={() => bag.remove(i)} aria-label={`Remove ${d.name}`}>
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      <p className="total">Total ${bag.total.toFixed(2)}</p>
      <div className="actions">
        {/* Deliberate usability defect for testing: "Continue" returns to the menu; "Save bag" goes to checkout. */}
        <Button onClick={() => go("/")}>Continue</Button>
        <Button variant="outline" onClick={() => go("/checkout")}>
          Save bag
        </Button>
      </div>
    </section>
  );
}
