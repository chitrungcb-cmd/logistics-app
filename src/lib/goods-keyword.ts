/**
 * Shipment goods names are free text. This deliberately small normalizer gives us a stable,
 * explainable product-group key without pretending to be a full product classifier.
 */
export function getGoodsKeyword(goodsName: string | null | undefined): string | null {
  if (!goodsName) return null;
  const withoutQty = goodsName.replace(/^\d+\s+/, "").trim();
  const words = withoutQty.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, 2).join(" ").toUpperCase();
}
