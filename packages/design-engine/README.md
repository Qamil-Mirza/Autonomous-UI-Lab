# @ghostloop/design-engine

Presentation layer on top of `@ghostloop/contracts`. `PresentedElement` extends the contract's `ManifestElement` with the state that mutation patches change:

| Field | Patched by | Meaning |
|---|---|---|
| `label` (contract) | `set_label` | Visible text |
| `styleToken` | `set_style_token` | One of `button.primary`, `button.secondary`, `emphasis.strong` |
| `order` | `set_order` | Position within the element's render group (lower first) |
| `visible` | `set_visibility` | `false` hides the element; absent means visible |

A presented manifest may also carry `patchIds`: the patches applied to `parentVersionId` to produce it.

`parseManifest(json)` validates against the contract's `DesignManifest` first (including its unique-`elementId` rule), then against `PresentedManifest`. A presented manifest is therefore always a valid contract manifest.

## Design versions

Manifests live at `designs/versions/<versionId>.json`. The prototype fetches them at runtime, so a new candidate file loads without a rebuild.

`manifestHash` is `sha256:` followed by the hex SHA-256 of `JSON.stringify(elements)`. Recompute it after editing a manifest:

```sh
node -e 'const f=require("fs"),p=process.argv[1],m=JSON.parse(f.readFileSync(p,"utf8"));console.log("sha256:"+require("crypto").createHash("sha256").update(JSON.stringify(m.elements)).digest("hex"))' designs/versions/ver_baseline.json
```

## Patches

Patches are applied with `applyPatches(source, patches, { newVersionId? })` from **`@ghostloop/design-engine/patch`**. This is a separate subpath because it hashes with `node:crypto`, and the browser app imports the package index.

It turns `MutationPatch`es (from `@ghostloop/contracts`) into a **new** design version:
- **Deterministic:** the same source and patches give the same elements and hash. Only `versionId` is fresh.
- **Pure:** `source` is never mutated.
- **All or nothing:** every patch is validated before any is applied. The first problem throws a `PatchError`, which has a `code`, a `patchId` and a message naming the patch, element and op, for example `patch pat_x (set_label plan.free.price): plan.free.price is protected (pricing)`. There is never a partial result.

### Rejections, in the order they're checked

| `code` | When |
|---|---|
| `invalid_patch` | The patch fails the contract's `MutationPatch` schema. |
| `invalid_value` | The `value` has the wrong type for its op, e.g. a non-boolean `set_visibility` (also reported at this step). |
| `stale_source` | `patch.sourceVersionId` isn't `source.versionId`. |
| `not_applicable` | `risk` is `blocked`, or `state` is `blocked` or `declined`. The message includes `blockReason` when there is one. |
| `unknown_element` | No element has `targetElementId`. |
| `protected_element` | The target has `protected: true`. The message lists its categories, e.g. `signup.submit is protected (signup)`. |
| `unsupported_op` | The op isn't in the target's `supportedOps`. This is also what limits `set_visibility` to elements that declare it. |
| `invalid_value` | The value breaks the op's rule (see the next table). |
| `conflict` | Two patches apply the same op to the same element, or two patches share an ID. |

### Op rules

| Op | Value |
|---|---|
| `set_label` | A non-blank string of at most 120 characters. |
| `set_style_token` | One of the approved `StyleToken`s: `button.primary`, `button.secondary`, `emphasis.strong`. |
| `set_visibility` | A boolean. |
| `set_order` | One of the order values (slots) the element's **render group** currently holds. |

### Render groups and `set_order`

`RENDER_GROUPS` (in `src/groups.ts`, exported from the index) lists the elements the prototype renders together in manifest order. Each group is one `<Ordered group="…">` block, and the app throws if a block's children ever differ from its group.

Orders are screen-wide numbers, and a group's members hold some of them. For `plan.heading` that's `plan.title` = 1 and `plan.helper` = 2.

`set_order` with value `v` works like this:
1. The element moves into the group's slot `v`.
2. The members in between shift by one slot.
3. Afterwards the element's `order` is `v`, and orders outside the group are untouched.

A reorder is rejected if:
- the element isn't in a group, or its group has only one member
- `v` isn't one of the group's slots
- it would change the order of a **protected** element
- it would change the relative order of the group's **interactive** members (textbox, checkbox, button and link roles), i.e. the required workflow order

In practice, only heading/helper pairs can be reordered on the baseline. No baseline element declares `set_order` yet.

### Result fields

| Field | Value |
|---|---|
| `versionId` | A fresh `ver_…` ID. `newVersionId` overrides it, e.g. in tests. |
| `parentVersionId` | `source.versionId`. |
| `patchIds` | The applied patch IDs, in order. This is an optional `PresentedManifest` field; original designs don't have it. |
| `manifestHash` | `computeManifestHash(elements)`, the same rule as above. |

The result is a valid contract `DesignManifest`.

## Manifest diff

`diffManifests(parent, child)` returns one `{ elementId, screen, changes }` entry per element whose presentation changed, in the child's element order. Each change is `{ field: "label" | "visible" | "styleToken" | "order", from, to }`. An absent `visible` counts as `true`, and other absent fields count as `null`. It throws if the two manifests don't have the same element IDs.

## Figma correspondence

Used by the Figma variant workflow (`docs/figma-variant-workflow.md`):
- **`figma/snapshot.js`:** a read-only `use_figma` script that snapshots every layer named by an element ID in the given frames. Save its result as a `FigmaSnapshot` (`{ fileKey, frames }`).
- **`checkVariant({ parent, child, baselineFrames, variantFrames })`:** checks that changed fields show the candidate's values, and that protected and unchanged elements are identical to the baseline frame. `styleToken` and `order` changes can't be represented in Figma, so they fail with a note (`UNSUPPORTED_IN_FIGMA`) instead of being faked.
- **`checkBaseline({ manifest, frames })`:** checks that every element has a layer, a matching label and matching visibility on its screen's frames.

Both return `{ status: "verified" | "mismatch", checks: FigmaCheck[] }`.
