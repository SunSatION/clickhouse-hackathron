import express from "express";

const app = express();

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, hello: "from src/server.ts" });
});

app.get("/api/echo", (req, res) => {
  res.status(200).json({ url: req.url, method: req.method });
});

export default app;
