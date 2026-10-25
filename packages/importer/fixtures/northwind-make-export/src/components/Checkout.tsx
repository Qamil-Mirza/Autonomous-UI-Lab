import { useState } from "react";
import { Button } from "./ui/button";
import type { BagState } from "./useBag";

export function Checkout({ bag, go }: { bag: BagState; go: (to: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [time, setTime] = useState("asap");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (bag.count === 0) return setError("Your bag is empty. Add a drink first.");
    if (!name.trim()) return setError("Enter the name for the order.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError("Enter a valid email address for the receipt.");
    setError("");
    bag.clear();
    go("/order/confirmed");
  };

  return (
    <section>
      <h1>Pickup details</h1>
      <form className="form" onSubmit={submit} noValidate>
        <label>
          Name for the order
          <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Email for the receipt
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Pickup time
          <select value={time} onChange={(e) => setTime(e.target.value)}>
            <option value="asap">As soon as possible</option>
            <option value="15">In 15 minutes</option>
            <option value="30">In 30 minutes</option>
          </select>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit">Submit</Button>
      </form>
    </section>
  );
}
