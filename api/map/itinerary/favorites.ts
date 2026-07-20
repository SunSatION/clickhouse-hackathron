import type { VercelRequest, VercelResponse } from "@vercel/node";

interface FavoriteTrip {
  id: string;
  itineraryId: string;
  title: string;
  totalPrice: number;
  currency: string;
  legs: unknown[];
  savedAt: string;
}

const FAVORITES: FavoriteTrip[] = [];

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    res.json({ ok: true, count: FAVORITES.length, favorites: FAVORITES });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
}
