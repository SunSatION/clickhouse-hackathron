import { z } from "zod";
import { defineTool } from "./registry.js";
import { removeFavorite } from '../../db/itinerary.js';

export const ToolRemoveFavorite = defineTool({
  id: "tool-remove-favorite",
  name: "remove_favorite",
  description: "Remove a saved favorite by its favorite id.",
  schema: z.object({ favoriteId: z.string().uuid() }),
  handler: async ({ favoriteId }) => ({ ok: removeFavorite(favoriteId) }),
});
