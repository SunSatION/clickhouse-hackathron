import data from "../../public/data/airports.json";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  const airline = (req.query?.airline || "Ryanair").toString();
  const airports = (data.airports || []).map((a) => ({
    ...a,
    originCount: 0,
    destinationCount: 0,
  }));
  res.json({ ok: true, airline, count: airports.length, airports });
}
