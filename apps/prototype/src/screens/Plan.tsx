import { Stage } from "../components/Stage";
import { ApiError, BackLink, Button, Ordered, Text } from "../components/controls";
import { useFlow, useGo, type Plan as PlanId } from "../state/flow";
import { useStep } from "../state/run";
import bullet from "../assets/bullet.svg";

const BULLETS: Record<PlanId, string[]> = {
  free: ["Up to 3 teammates", "500 contacts", "Basic pipeline"],
  pro: ["Unlimited teammates", "Unlimited contacts", "Automations"],
};

function Bullets({ plan }: { plan: PlanId }) {
  return (
    <ul className="plan-bullets">
      {BULLETS[plan].map((text) => (
        <li key={text}>
          <img src={bullet} width={4} height={4} alt="" />
          {text}
        </li>
      ))}
    </ul>
  );
}

export function Plan() {
  const go = useGo();
  const { update } = useFlow();
  const { send, failed } = useStep<"plan">("plan");
  // Choosing Pro starts a paid trial server-side, which the goal checker sees even if the user comes back for Free.
  const choose = async (plan: PlanId) => {
    const result = await send({ plan });
    if (result?.kind !== "ok") return;
    update({ plan });
    go("invite");
  };

  return (
    <Stage step={3}>
      <section className="plan">
        <BackLink id="plan.back" to="workspace" />
        <Ordered group="plan.heading">
          {{
            "plan.title": <Text id="plan.title" as="h1" className="title" />,
            "plan.helper": <Text id="plan.helper" className="helper" />,
          }}
        </Ordered>
        <div className="plan-cards">
          <article className="plan-card">
            <p className="plan-name">Free</p>
            <Ordered group="plan.free">
              {{
                "plan.free.price": <Text id="plan.free.price" className="plan-price" />,
                "plan.free.note": <Text id="plan.free.note" className="plan-note" />,
              }}
            </Ordered>
            <Bullets plan="free" />
            <Button id="plan.free.cta" className="plan-cta" onClick={() => choose("free")} />
          </article>
          <article className="plan-card">
            <p className="plan-name">Pro</p>
            <span className="plan-badge">Recommended</span>
            <Ordered group="plan.pro">
              {{
                "plan.pro.price": <Text id="plan.pro.price" className="plan-price" />,
                "plan.pro.note": <Text id="plan.pro.note" className="plan-note" />,
              }}
            </Ordered>
            <Bullets plan="pro" />
            <Button id="plan.pro.cta" className="plan-cta" minWidth={118} onClick={() => choose("pro")} />
          </article>
        </div>
        <ApiError show={failed} />
      </section>
    </Stage>
  );
}
