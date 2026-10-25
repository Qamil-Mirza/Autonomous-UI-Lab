import { describe, expect, it } from "vitest";
import type { MutationPatch } from "@ghostloop/contracts";
import { ImportError } from "../src/errors";
import { buildManifest, jsxRenderedText, protectedByTask, toDesignManifest } from "../src/manifest";
import { applyLabelPatches, diffAgainstParent } from "../src/patch";
import { ImportStore } from "../src/store";
import { ImportTask } from "../src/task";

const APP = `import { Button } from "./components/ui/button";
export default function App() {
  return (
    <main>
      <h1>Your cart</h1>
      <p>
        Review your order
        before paying.
      </p>
      <button onClick={() => go()}>Next</button>
      <a href="/help">Need help?</a>
      <span>Tom &amp; Jerry</span>
      <Button>Next</Button>
      <p>Order confirmed</p>
    </main>
  );
}
`;
const UI = `export function Button(props) { return <button {...props}>Default</button>; }`;

const files = () =>
  new Map<string, Buffer>([
    ["src/App.tsx", Buffer.from(APP)],
    ["src/components/ui/button.tsx", Buffer.from(UI)],
    ["src/main.tsx", Buffer.from("render(<App />)")],
    ["package.json", Buffer.from("{}")],
  ]);

const manifestFor = (f = files(), versionId = "ver_imp_aaaaaaaaaaaa") =>
  buildManifest({ versionId, sourceHash: ImportStore.sourceHash(f), files: f });

const patch = (over: Partial<MutationPatch> & { targetElementId: string; value: string }): MutationPatch =>
  ({
    schemaVersion: "1.0.0",
    id: "pat_1",
    experimentId: "exp_1",
    round: 1,
    sourceVersionId: "ver_imp_aaaaaaaaaaaa",
    op: "set_label",
    observationIds: ["obs_1"],
    rationale: "clearer",
    risk: "review_required",
    state: "approved",
    ...over,
  }) as MutationPatch;

const byLabel = (label: string) => manifestFor().elements.find((e) => e.label === label)!;

describe("buildManifest", () => {
  it("lists literal JSX text with exact source locations, skipping UI primitives", () => {
    const m = manifestFor();
    expect(m.elements.map((e) => e.label)).toEqual([
      "Your cart",
      "Review your order before paying.",
      "Next",
      "Need help?",
      "Tom &amp; Jerry",
      "Next",
      "Order confirmed",
    ]);
    const cart = byLabel("Your cart");
    expect(cart.elementId).toBe("t:src/App.tsx:1");
    expect(cart.role).toBe("heading");
    expect(cart.source).toMatchObject({ file: "src/App.tsx", line: 5, tag: "h1", raw: "Your cart" });
    expect(APP.slice(cart.source.start, cart.source.end)).toBe("Your cart");
    expect(byLabel("Need help?").role).toBe("link");
  });

  it("follows React's whitespace rules for multi-line text", () => {
    expect(jsxRenderedText("Review your order\n        before paying.")).toBe("Review your order before paying.");
  });

  it("marks ambiguous and entity text as not editable, with a reason", () => {
    const next = manifestFor().elements.filter((e) => e.label === "Next");
    expect(next).toHaveLength(2);
    for (const el of next) {
      expect(el.supportedOps).toEqual([]);
      expect(el.note).toMatch(/several places/);
    }
    expect(byLabel("Tom &amp; Jerry").supportedOps).toEqual([]);
    expect(byLabel("Your cart").supportedOps).toEqual(["set_label"]);
  });

  it("is deterministic and independent of any task", () => {
    expect(manifestFor().manifestHash).toBe(manifestFor().manifestHash);
    expect(toDesignManifest(manifestFor()).elements[0]).not.toHaveProperty("source");
  });

  it("protects text used by success checks and text the designer protected", () => {
    const task = ImportTask.parse({
      task: "Check out the cart and confirm the order.",
      startRoute: "/",
      viewport: { width: 1280, height: 800 },
      successChecks: [{ kind: "text", text: "Order confirmed" }],
      protectedTexts: ["need help"],
    });
    const p = protectedByTask(manifestFor(), task);
    expect(p).toEqual([
      { elementId: byLabel("Need help?").elementId, reason: "protected by the designer" },
      { elementId: byLabel("Order confirmed").elementId, reason: "used by a success check" },
    ]);
  });
});

describe("applyLabelPatches", () => {
  const reason = (fn: () => unknown) => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ImportError);
      return (err as ImportError).message;
    }
    throw new Error("expected a rejection");
  };

  it("changes exactly the approved text and nothing else", () => {
    const f = files();
    const m = manifestFor(f);
    const target = byLabel("Your cart");
    const { files: out, changes } = applyLabelPatches(f, m, [patch({ targetElementId: target.elementId, value: "Your basket" })]);
    expect(changes).toEqual([{ patchId: "pat_1", elementId: target.elementId, file: "src/App.tsx", line: 5, before: "Your cart", after: "Your basket" }]);
    expect(out.get("src/App.tsx")!.toString()).toBe(APP.replace("<h1>Your cart</h1>", "<h1>Your basket</h1>"));
    expect(out.get("src/main.tsx")).toBe(f.get("src/main.tsx"));

    const candidate = buildManifest({ versionId: "ver_imp_bbbbbbbbbbbb", parentVersionId: m.versionId, sourceHash: ImportStore.sourceHash(out), files: out });
    expect(diffAgainstParent({ expectedFiles: out, candidateFiles: out, parent: m, candidate, changes })).toEqual([]);
    // Any other change is caught.
    const tampered = new Map(out);
    tampered.set("src/main.tsx", Buffer.from("render(<Evil />)"));
    expect(diffAgainstParent({ expectedFiles: out, candidateFiles: tampered, parent: m, candidate, changes })).toEqual(["unapproved change in src/main.tsx"]);
  });

  it("rejects unapproved, blocked, unsupported, stale, protected and ambiguous patches", () => {
    const f = files();
    const m = manifestFor(f);
    const id = byLabel("Your cart").elementId;
    expect(reason(() => applyLabelPatches(f, m, [patch({ targetElementId: id, value: "x", state: "proposed" })]))).toMatch(/not approved/);
    expect(reason(() => applyLabelPatches(f, m, [patch({ targetElementId: id, value: "x", risk: "blocked" })]))).toMatch(/blocked/);
    expect(reason(() => applyLabelPatches(f, m, [{ ...patch({ targetElementId: id, value: "x" }), op: "set_visibility", value: false } as MutationPatch]))).toMatch(/only text label/);
    expect(reason(() => applyLabelPatches(f, m, [patch({ targetElementId: id, value: "x", sourceVersionId: "ver_imp_cccccccccccc" })]))).toMatch(/proposed for/);
    expect(reason(() => applyLabelPatches(f, m, [patch({ targetElementId: "t:src/App.tsx:99", value: "x" })]))).toMatch(/does not exist/);
    expect(reason(() => applyLabelPatches(f, m, [patch({ targetElementId: id, value: "x" })], { protectedElementIds: new Set([id]) }))).toMatch(/protected/);
    expect(reason(() => applyLabelPatches(f, m, [patch({ targetElementId: byLabel("Next").elementId, value: "Continue" })]))).toMatch(/several places/);
    expect(reason(() => applyLabelPatches(f, m, [patch({ targetElementId: id, value: "<b>x</b>" })]))).toMatch(/markup/);
    expect(reason(() => applyLabelPatches(f, m, [patch({ targetElementId: id, value: "a" }), patch({ id: "pat_2", targetElementId: id, value: "b" })]))).toMatch(/also changes/);
  });

  it("rejects a patch against source that no longer matches the manifest", () => {
    const f = files();
    const m = manifestFor(f);
    const edited = new Map(f);
    edited.set("src/App.tsx", Buffer.from(APP.replace("Your cart", "Your bag")));
    expect(() => applyLabelPatches(edited, m, [patch({ targetElementId: byLabel("Your cart").elementId, value: "Basket" })])).toThrow(/differs from the version/);
  });
});
