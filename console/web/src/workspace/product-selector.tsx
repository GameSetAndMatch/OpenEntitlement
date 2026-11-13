export interface ProductSummary { id: string; key: string; name: string; role: string; archivedAt?: string | null }

/** The Product the person picks from a remembered choice, falling back to the first one they can see. */
export function pickProduct(products: ProductSummary[], preferred: string) {
  return products.find(p => p.id === preferred)?.id ?? products[0]?.id ?? "";
}

/**
 * The Product selector at the top of the sidebar (ADR-0008). Catalog and Tiers show the selected
 * Product. It lists only the Products where the person has a Role, and is hidden with one Product.
 */
export function ProductSelector({ products, current, onSelect, disabled }: {
  products: ProductSummary[]; current: string; onSelect: (id: string) => void; disabled?: boolean;
}) {
  if (products.length < 2) return null;
  return <label className="product-selector">
    <span>Product</span>
    <select value={current} disabled={disabled} onChange={e => onSelect(e.target.value)}>
      {products.map(p => <option key={p.id} value={p.id}>{p.archivedAt ? `${p.name} (archived)` : p.name}</option>)}
    </select>
  </label>;
}
