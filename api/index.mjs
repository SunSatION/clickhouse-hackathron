import { app } from "../src/frontend/server.js";
export default function handler(req, res) {
  return app(req, res);
}
