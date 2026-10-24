import { z } from "zod";

// Hidden from the agent and from the public index; only the trusted checker consumes this.
export const HiddenGoalSpec = z.object({
  ref: z.string().min(1),
  description: z.string().min(1),
  checkerId: z.string().min(1),
});
export type HiddenGoalSpec = z.infer<typeof HiddenGoalSpec>;
