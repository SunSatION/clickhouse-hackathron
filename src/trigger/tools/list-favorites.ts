import { z } from "zod";
import { defineTool } from "./registry.js";
import { listFavorites } from '../../db/itinerary.js';

export const ToolListFavorites = defineTool({
  id: "tool-list-favorites",
  name: "list_favorites",
  description: "List the user's saved trip itineraries.",
  schema: z.object({}),
  handler: async () => ({ ok: true, count: listFavorites().length, favorites: listFavorites() }),
});
