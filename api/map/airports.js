module.exports = (req, res) => {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
  res.status(200).json({ ok: true, airline: "Ryanair", count: 0, airports: [] });
};
