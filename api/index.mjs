import { app } from "../src/frontend/server.mjs";
export default function handler(req, res) {
  return app(req, res);
}
