import { app } from "../src/frontend/server";
export default function handler(req, res) {
  return app(req, res);
}
