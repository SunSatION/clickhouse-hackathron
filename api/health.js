module.exports = function handler(req, res) {
  res.json({ ok: true, route: "health", method: req.method });
};
