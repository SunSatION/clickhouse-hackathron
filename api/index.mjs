import express from "express";
const app = express();
app.get("/api/health", (req, res) => res.json({ ok: true, hello: "world" }));
app.get("/api/:any*", (req, res) => res.json({ ok: true, route: req.params.any, url: req.url }));
export default function handler(req, res) {
  return app(req, res);
}
