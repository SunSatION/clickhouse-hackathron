import { app } from "../src/frontend/server.ts";
export default function handler(req, res) {
  return app(req, res);
}
