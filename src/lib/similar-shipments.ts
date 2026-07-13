import { prisma } from "@/lib/prisma";

/**
 * There's no HS-code/product-category field on Shipment — goodsName is free text derived from the
 * email subject (see tokhai-parser/gmail sync). This extracts a rough "product type" key by
 * stripping the leading quantity number and taking the first two words, e.g.
 * "1 MÁY KHOAN CỌC NHỒI CŨ 300" → "MÁY KHOAN", "20 ĐẦU KÉO 445" → "ĐẦU KÉO". Two shipments are
 * "similar" when this key matches exactly — a deliberately simple approximation (no fuzzy/trigram
 * matching) since it's easy to reason about and tune, and the data volume doesn't need anything
 * more sophisticated.
 */
export function getGoodsKeyword(goodsName: string | null | undefined): string | null {
  if (!goodsName) return null;
  const withoutQty = goodsName.replace(/^\d+\s+/, "").trim();
  const words = withoutQty.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words.slice(0, 2).join(" ").toUpperCase();
}

export async function findSimilarShipments(params: {
  shipmentId: string;
  goodsName: string | null;
  monthsBack?: number;
  limit?: number;
}) {
  const keyword = getGoodsKeyword(params.goodsName);
  if (!keyword) {
    return { keyword: null as string | null, shipments: [] as SimilarShipment[] };
  }

  const since = params.monthsBack
    ? new Date(Date.now() - params.monthsBack * 30 * 24 * 60 * 60 * 1000)
    : undefined;

  const candidates = await prisma.shipment.findMany({
    where: {
      id: { not: params.shipmentId },
      goodsName: { not: null },
      ...(since ? { declarationDate: { gte: since } } : {}),
    },
    select: {
      id: true,
      shipmentCode: true,
      customerName: true,
      declarationNo: true,
      declarationDate: true,
      goodsName: true,
    },
    orderBy: { declarationDate: "desc" },
  });

  const matches = candidates.filter((c) => getGoodsKeyword(c.goodsName) === keyword);
  return { keyword, shipments: params.limit ? matches.slice(0, params.limit) : matches };
}

type SimilarShipment = {
  id: string;
  shipmentCode: string;
  customerName: string;
  declarationNo: string | null;
  declarationDate: Date | null;
  goodsName: string | null;
};
