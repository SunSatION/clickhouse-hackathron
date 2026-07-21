import { z } from "zod";
import { defineTool } from "./registry";
import { getDatasetFreshness, buildToolHints } from '../../db/fare-finder';

export const ToolDatasetFreshness = defineTool({
  id: "tool-dataset-freshness",
  name: "get_dataset_freshness",
  description:
    "Returns how fresh the flight_listings data is (max observed_at per airline + per route) plus row counts. Use this BEFORE quoting prices so the LLM can warn the user if data is stale or sparse.",
  schema: z.object({}),
  handler: async () => {
    const f = await getDatasetFreshness();
    return { ok: true, freshness: f, hints: buildToolHints(f) };
  },
});
