import { useState, type FormEvent } from "react";
import { Stage } from "../components/Stage";
import { ApiError, BackLink, Button, Ordered, Text, TextField } from "../components/controls";
import { useEl } from "../manifest/context";
import { useFlow, useGo } from "../state/flow";
import { useStep } from "../state/run";
import { isEmail } from "@ghostloop/prototype-adapter/validation";

export function Invite() {
  const go = useGo();
  const { flow, update } = useFlow();
  const form = useEl("invite.form");
  const [invalid, setInvalid] = useState(false);
  const { send, failed } = useStep<"email">("invite");

  // Re-checked on every submit, so resubmitting an unchanged invalid address keeps the error.
  // The simulated invite service records only addresses it accepts as sent.
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(flow.inviteEmail)) {
      setInvalid(true);
      return;
    }
    const result = await send({ email: flow.inviteEmail });
    if (result?.kind === "invalid") setInvalid(true);
    if (result?.kind === "ok") go("confirm");
  };

  return (
    <Stage step={4}>
      <form className="card" style={{ minHeight: 238, padding: "36px 47px 30px" }} noValidate onSubmit={submit} data-testid={form.testId}>
        <BackLink id="invite.back" to="plan" />
        <Ordered group="invite.heading">
          {{
            "invite.title": <Text id="invite.title" as="h1" className="title" />,
            "invite.helper": <Text id="invite.helper" className="helper" />,
          }}
        </Ordered>
        <div className="field-row">
          <Ordered group="invite.fields">
            {{
              "invite.email": (
                <TextField
                  id="invite.email"
                  type="email"
                  placeholder="name@company.com"
                  autoComplete="email"
                  width={350}
                  value={flow.inviteEmail}
                  errorId={invalid ? "invite.error" : undefined}
                  onChange={(inviteEmail) => {
                    update({ inviteEmail });
                    setInvalid(false);
                  }}
                />
              ),
              "invite.send": <Button id="invite.send" type="submit" />,
            }}
          </Ordered>
        </div>
        <ApiError show={failed} />
      </form>
    </Stage>
  );
}
