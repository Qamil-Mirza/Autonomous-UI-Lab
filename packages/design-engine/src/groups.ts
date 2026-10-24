// Elements the prototype renders together in manifest order (one <Ordered group=…> block each). set_order may only
// move an element within its own group. The app asserts its blocks match this list, so the two can't drift.
export const RENDER_GROUPS = {
  "signup.form": ["signup.title", "signup.helper", "signup.name", "signup.email", "signup.password", "signup.consent", "signup.consent.error", "signup.submit"],
  "workspace.heading": ["workspace.title", "workspace.helper"],
  "workspace.fields": ["workspace.name", "workspace.continue"],
  "plan.heading": ["plan.title", "plan.helper"],
  "plan.free": ["plan.free.price", "plan.free.note"],
  "plan.pro": ["plan.pro.price", "plan.pro.note"],
  "invite.heading": ["invite.title", "invite.helper"],
  "invite.fields": ["invite.email", "invite.send"],
  "confirm.content": ["confirm.title", "confirm.helper", "confirm.summary", "confirm.done"],
} as const satisfies Record<string, readonly string[]>;

export type RenderGroup = keyof typeof RENDER_GROUPS;

// Roles that make up the task workflow; set_order never changes their relative order within a group.
export const INTERACTIVE_ROLES: readonly string[] = ["textbox", "checkbox", "button", "link"];

export function groupOf(elementId: string): RenderGroup | undefined {
  return (Object.keys(RENDER_GROUPS) as RenderGroup[]).find((g) => (RENDER_GROUPS[g] as readonly string[]).includes(elementId));
}
