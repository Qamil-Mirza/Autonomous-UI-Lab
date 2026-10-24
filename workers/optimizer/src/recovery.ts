import type { ExperimentStore } from "./store";

/**
 * Startup repair for an `approvePatches` that crashed between claiming the round (`round.approvalId`) and writing the
 * Approval record (spec §5.1). Such a round would park forever and every retry would get `ALREADY_APPROVED`, so the
 * claim is cleared and the round's `approved`/`declined` patches go back to `proposed`; the designer resubmits.
 *
 * Run once after hydration and before any command or drive. Never call it from `step()`: in a live process a drive
 * can observe the window between the claim and the Approval write of an approval still in progress, and repairing
 * there would undo it. Returns the repaired experiment ids.
 */
export async function recoverInterruptedApprovals(store: ExperimentStore): Promise<string[]> {
  const repaired: string[] = [];
  for (const exp of await store.listExperiments()) {
    if (exp.state !== "awaiting_approval" || !exp.round.approvalId) continue;
    if (await store.getApproval(exp.id, exp.round.index)) continue;
    for (const p of await store.listPatches(exp.id, exp.round.index)) {
      if (p.state === "approved" || p.state === "declined") await store.updatePatch(p.id, { state: "proposed" });
    }
    await store.updateExperiment(exp.id, (x) => {
      const { approvalId: _claim, ...round } = x.round;
      return { ...x, round };
    });
    repaired.push(exp.id);
  }
  return repaired;
}
