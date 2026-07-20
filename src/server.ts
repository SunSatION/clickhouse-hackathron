import express from "express";

const app = express();

app.use((req, _res, next) => {
  console.log("req:", req.method, req.url);
  next();
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, hello: "world" });
});

app.get("/api/map/airports", (req, res) => {
  res.status(200).json({ ok: true, route: "airports", url: req.url });
});

export default app;
