# @ghostloop/design-engine

Presentation layer on top of `@ghostloop/contracts`. `PresentedElement` extends the contract's `ManifestElement` with the state that mutation patches change:

| Field | Patched by | Meaning |
|---|---|---|
| `label` (contract) | `set_label` | Visible text |
| `styleToken` | `set_style_token` | One of `button.primary`, `button.secondary`, `emphasis.strong` |
| `order` | `set_order` | Position within the element's render group (lower first) |
| `visible` | `set_visibility` | `false` hides the element; absent means visible |

`parseManifest(json)` validates against the contract's `DesignManifest` first (including its unique-`elementId` rule), then against `PresentedManifest`. A presented manifest is therefore always a valid contract manifest.

## Design versions

Manifests live at `designs/versions/<versionId>.json`. The prototype fetches them at runtime, so a new candidate file loads without a rebuild.

`manifestHash` is `sha256:` followed by the hex SHA-256 of `JSON.stringify(elements)`. Recompute it after editing a manifest:

```sh
node -e 'const f=require("fs"),p=process.argv[1],m=JSON.parse(f.readFileSync(p,"utf8"));console.log("sha256:"+require("crypto").createHash("sha256").update(JSON.stringify(m.elements)).digest("hex"))' designs/versions/ver_baseline.json
```
