const FAVORITES = [];

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.json({ ok: true, count: FAVORITES.length, favorites: FAVORITES });
  }

  if (req.method === "POST") {
    try {
      const it = req.body?.itinerary;
      if (!it || !it.id) {
        return res.status(400).json({ ok: false, error: "missing itinerary.id" });
      }
      const fav = {
        id: crypto.randomUUID(),
        itineraryId: it.id,
        title: it.title,
        totalPrice: it.totalPrice,
        currency: it.currency,
        legs: it.legs || [],
        savedAt: new Date().toISOString(),
      };
      FAVORITES.unshift(fav);
      return res.json({ ok: true, favorite: fav });
    } catch (err) {
      return res.status(500).json({ ok: false, error: String(err) });
    }
  }

  if (req.method === "DELETE") {
    const id = req.query?.id;
    if (!id) return res.status(400).json({ ok: false, error: "missing id" });
    const idx = FAVORITES.findIndex((f) => f.id === id);
    if (idx >= 0) FAVORITES.splice(idx, 1);
    return res.json({ ok: true });
  }

  res.setHeader("Allow", "GET, POST, DELETE");
  res.status(405).json({ ok: false, error: "method not allowed" });
}
