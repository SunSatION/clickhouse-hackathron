module.exports = (req, res) => {
  const baseUrl = `https://${process.env.VERCEL_URL || "clickhouse-hackathron.vercel.app"}`;
  const url = baseUrl + "/data/airports.json";
  fetch(url)
    .then(r => {
      if (!r.ok) throw new Error("fetch failed: " + r.status);
      return r.json();
    })
    .then(json => {
      const airports = json.airports || [];
      const rows = airports.map(a => ({ ...a, originCount: 0, destinationCount: 0 }));
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json({ ok: true, airline: "Ryanair", count: rows.length, airports: rows });
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ ok: false, error: String(err) });
    });
};
