console.log("[api/index.mjs] handler loaded");
export default function handler(req, res) {
  console.log("[api/index.mjs] called", req.method, req.url);
  res.status(200).json({ ok: true, url: req.url, method: req.method });
}
