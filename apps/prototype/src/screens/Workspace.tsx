import { useState, type FormEvent } from "react";
import { Stage } from "../components/Stage";
import { ApiError, BackLink, Button, Ordered, Text, TextField } from "../components/controls";
import { useEl } from "../manifest/context";
import { useFlow, useGo } from "../state/flow";
import { useStep } from "../state/run";
import { isFilled } from "@ghostloop/prototype-adapter/validation";

export function Workspace() {
  const go = useGo();
  const { flow, update } = useFlow();
  const form = useEl("workspace.form");
  const [nameError, setNameError] = useState(false);
  const { send, failed } = useStep<"name">("workspace");

  // The server upserts the run's single workspace, so Back + resubmit renames rather than adding one.
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isFilled(flow.workspace)) {
      setNameError(true);
      return;
    }
    const result = await send({ name: flow.workspace });
    if (result?.kind === "invalid") setNameError(true);
    if (result?.kind === "ok") go("plan");
  };

  return (
    <Stage step={2}>
      <form className="card" style={{ minHeight: 238, padding: "36px 47px 30px" }} noValidate onSubmit={submit} data-testid={form.testId}>
        <BackLink id="workspace.back" to="signup" />
        <Ordered group="workspace.heading">
          {{
            "workspace.title": <Text id="workspace.title" as="h1" className="title" />,
            "workspace.helper": <Text id="workspace.helper" className="helper" />,
          }}
        </Ordered>
        <div className="field-row">
          <Ordered group="workspace.fields">
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
        <ApiError show={failed} />
      </form>
    </Stage>
  );
}
