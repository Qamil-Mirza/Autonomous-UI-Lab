// Read-only use_figma script: snapshots every layer named by an element ID in the given frames.
// Usage: replace __FRAMES__ with a JSON array of { "screen": "plan", "nodeId": "22:186" } and run it through the
// Figma MCP use_figma tool. Its return value is a FigmaFrameSnapshot[] (packages/design-engine/src/figma-check.ts);
// save it as { "fileKey": "...", "frames": <return value> } for `npm run figma:mapping`.
const FRAMES = __FRAMES__;
const ELEMENT_ID = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;
const r2 = (n) => Math.round(n * 100) / 100;
const paints = (ps) =>
  Array.isArray(ps) ? ps.filter((p) => p.visible !== false).map((p) => (p.type === "SOLID" ? `${p.type}(${r2(p.color.r)},${r2(p.color.g)},${r2(p.color.b)},${r2(p.opacity ?? 1)})` : p.type)).join("+") : "mixed";
const styleOf = (n) => {
  const parts = [n.type];
  if ("fills" in n) parts.push(`fill=${paints(n.fills)}`);
  if ("strokes" in n && n.strokes.length) parts.push(`stroke=${paints(n.strokes)}@${typeof n.strokeWeight === "number" ? r2(n.strokeWeight) : "mixed"}`);
  if (n.type === "TEXT") {
    const f = n.fontName;
    parts.push(`font=${typeof f === "symbol" ? "mixed" : `${f.family} ${f.style}`}/${typeof n.fontSize === "number" ? r2(n.fontSize) : "mixed"}`);
  }
  return parts.join(" ");
};
// Pages load incrementally: switch once to the page holding the frames (all frames must share one page).
const pageOf = (n) => { while (n && n.type !== "PAGE") n = n.parent; return n; };
const page = pageOf(await figma.getNodeByIdAsync(FRAMES[0].nodeId));
await figma.setCurrentPageAsync(page);
const out = [];
for (const { screen, nodeId } of FRAMES) {
  const frame = await figma.getNodeByIdAsync(nodeId);
  if (!frame || frame.type !== "FRAME") throw new Error(`${nodeId} is not a frame`);
  if (pageOf(frame) !== page) throw new Error(`${nodeId} is not on page ${page.name}; snapshot one page per call`);
  const fx = frame.absoluteTransform[0][2], fy = frame.absoluteTransform[1][2];
  const elements = {};
  for (const node of frame.findAll((n) => ELEMENT_ID.test(n.name) && !n.name.startsWith("decor."))) {
    let visible = node.visible;
    for (let p = node.parent; visible && p && p !== frame; p = p.parent) visible = p.visible;
    const subtree = "findAll" in node ? [node, ...node.findAll(() => true)] : [node];
    elements[node.name] = {
      type: node.type,
      visible,
      texts: subtree.filter((n) => n.type === "TEXT").map((n) => n.characters),
      contains: subtree.slice(1).filter((n) => ELEMENT_ID.test(n.name)).map((n) => n.name),
      bounds: { x: r2(node.absoluteTransform[0][2] - fx), y: r2(node.absoluteTransform[1][2] - fy), width: r2(node.width), height: r2(node.height) },
      style: subtree.map((n) => `${n.name}:${styleOf(n)}`).join("|"),
    };
  }
  out.push({ screen, nodeId: frame.id, name: frame.name, elements });
}
return out;
