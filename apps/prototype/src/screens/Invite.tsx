import { useState, type FormEvent } from "react";
import { Stage } from "../components/Stage";
import { BackLink, Button, Ordered, Text, TextField } from "../components/controls";
import { useEl } from "../manifest/context";
import { useFlow, useGo } from "../state/flow";
import { isEmail } from "../state/validation";

export function Invite() {
  const go = useGo();
  const { flow, update } = useFlow();
  const form = useEl("invite.form");
  const [invalid, setInvalid] = useState(false);

  // Re-checked on every submit, so resubmitting an unchanged invalid address keeps the error.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isEmail(flow.inviteEmail)) {
      setInvalid(true);
      return;
    }
    go("confirm");
  };

  return (
    <Stage step={4}>
      <form className="card" style={{ minHeight: 238, padding: "36px 47px 30px" }} noValidate onSubmit={submit} data-testid={form.testId}>
        <BackLink id="invite.back" to="plan" />
        <Ordered>
          {{
            "invite.title": <Text id="invite.title" as="h1" className="title" />,
            "invite.helper": <Text id="invite.helper" className="helper" />,
          }}
        </Ordered>
        <div className="field-row">
          <Ordered>
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
      </form>
    </Stage>
  );
}
