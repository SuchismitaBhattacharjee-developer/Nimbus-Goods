/**
 * Stand-in for Dodo's product catalog. In production this is a server lookup keyed by
 * productId. The point: price, name and merchant come from here, never from the host page,
 * so a page can't make the checkout charge a different amount or claim to be someone else.
 */
export interface Product {
  id: string;
  name: string;
  summary: string;
  /** Minor units (cents). */
  amount: number;
  currency: string;
  merchant: string;
}

const PRODUCTS: Record<string, Product> = {
  prod_123: {
    id: "prod_123",
    name: "Nimbus Cloud Lamp",
    summary: "Dimmable · Warm white · USB-C",
    amount: 4800,
    currency: "USD",
    merchant: "Nimbus Goods",
  },
};

export function findProduct(id: string): Product | null {
  return Object.hasOwn(PRODUCTS, id) ? PRODUCTS[id]! : null;
}

export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}
