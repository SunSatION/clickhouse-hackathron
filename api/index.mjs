import { app } from "../src/frontend/server.bundled.mjs";
export default function handler(req, res) {
  return app(req, res);
}
