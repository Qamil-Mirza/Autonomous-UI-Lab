import { Stage } from "../components/Stage";
import { Button, Ordered, Text } from "../components/controls";
import { useEl } from "../manifest/context";
import { useFlow } from "../state/flow";
import checkIcon from "../assets/check-icon.svg";

function Summary() {
  const el = useEl("confirm.summary");
  const { flow } = useFlow();
  if (!el.visible) return null;
  // Falls back to the Figma sample values when a screen was skipped (e.g. deep-linking here).
  const rows: [string, string][] = [
    ["Workspace", flow.workspace.trim() || "Northwind Sales"],
    ["Plan", flow.plan === "pro" ? "Pro" : "Free"],
    ["Invite sent to", flow.inviteEmail.trim() || "jordan@northwind.test"],
  ];
  return (
    <dl className="summary" data-testid={el.testId}>
      {rows.map(([label, value]) => (
        <div className="summary-row" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Confirm() {
  return (
    <Stage step={5}>
      <section className="card" style={{ minHeight: 400, padding: "36px 48px 51px" }}>
        <img className="confirm-icon" src={checkIcon} width={28} height={28} alt="" />
        <Ordered group="confirm.content">
          {{
            "confirm.title": <Text id="confirm.title" as="h1" className="title" />,
            "confirm.helper": <Text id="confirm.helper" className="helper" />,
            "confirm.summary": <Summary />,
            // No dashboard exists yet; the button is the end of the flow.
            "confirm.done": <Button id="confirm.done" minWidth={128} />,
          }}
        </Ordered>
      </section>
    </Stage>
  );
}
