import { useEffect, useState } from "react";

export interface Drink {
  id: string;
  name: string;
  price: number;
}

export const DRINKS: Drink[] = [
  { id: "flat-white", name: "Flat white", price: 4.5 },
  { id: "oat-latte", name: "Oat latte", price: 5.25 },
  { id: "cold-brew", name: "Cold brew", price: 4.75 },
];

const KEY = "northwind.bag";

/** The bag, kept in localStorage like many Make prototypes keep local state. */
export function useBag() {
  const [items, setItems] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(items));
  }, [items]);
  const total = items.reduce((sum, id) => sum + (DRINKS.find((d) => d.id === id)?.price ?? 0), 0);
  return {
    items,
    count: items.length,
    total,
    add: (id: string) => setItems((xs) => [...xs, id]),
    remove: (index: number) => setItems((xs) => xs.filter((_, i) => i !== index)),
    clear: () => setItems([]),
  };
}

export type BagState = ReturnType<typeof useBag>;
