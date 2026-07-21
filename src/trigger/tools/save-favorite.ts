import { z } from "zod";
import { defineTool } from "./registry";
import { saveFavorite } from '../../db/itinerary';

export const ToolSaveFavorite = defineTool({
  id: "tool-save-favorite",
  name: "save_favorite",
  description: "Persist an itinerary (with its legs, price, currency) to the user's favorites.",
  schema: z.object({
    itinerary: z.object({
      id: z.string(),
      title: z.string(),
      totalPrice: z.number(),
      currency: z.string(),
      legs: z.array(z.object({
        origin: z.string(),
        destination: z.string(),
        date: z.string().optional(),
        price: z.number(),
        currency: z.string(),
        airline: z.string().optional(),
      })),
    }),
  }),
  handler: async ({ itinerary }) => {
    const fav = saveFavorite(itinerary as never);
    return { ok: true, favorite: fav };
  },
});
