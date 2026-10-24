import { useState, type FormEvent } from "react";
import { Stage } from "../components/Stage";
import { BackLink, Button, Ordered, Text, TextField } from "../components/controls";
import { useEl } from "../manifest/context";
import { useFlow, useGo } from "../state/flow";
import { isFilled } from "../state/validation";

export function Workspace() {
  const go = useGo();
  const { flow, update } = useFlow();
  const form = useEl("workspace.form");
  const [nameError, setNameError] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!isFilled(flow.workspace)) {
      setNameError(true);
      return;
    }
    go("plan");
  };

  return (
    <Stage step={2}>
      <form className="card" style={{ minHeight: 238, padding: "36px 47px 30px" }} noValidate onSubmit={submit} data-testid={form.testId}>
        <BackLink id="workspace.back" to="signup" />
        <Ordered>
          {{
            "workspace.title": <Text id="workspace.title" as="h1" className="title" />,
            "workspace.helper": <Text id="workspace.helper" className="helper" />,
          }}
        </Ordered>
        <div className="field-row">
          <Ordered>
            {{
              "workspace.name": (
                <TextField
                  id="workspace.name"
                  placeholder="Northwind Sales"
                  autoComplete="organization"
                  width={350}
                  value={flow.workspace}
                  errorId={nameError ? "workspace.name.error" : undefined}
                  onChange={(workspace) => {
                    update({ workspace });
                    setNameError(false);
                  }}
                />
              ),
              "workspace.continue": <Button id="workspace.continue" type="submit" />,
            }}
          </Ordered>
        </div>
      </form>
    </Stage>
  );
}
