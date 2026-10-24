import { useState, type FormEvent } from "react";
import { Stage } from "../components/Stage";
import { ApiError, Button, Checkbox, FieldError, Ordered, Text, TextField } from "../components/controls";
import { useFlow, useGo } from "../state/flow";
import { useStep } from "../state/run";
import { isEmail, isFilled, MIN_PASSWORD_LENGTH } from "@ghostloop/prototype-adapter/validation";

const FIELD_WIDTH = 466;

type Field = "name" | "email" | "password" | "consent";

export function Signup() {
  const go = useGo();
  const { flow, update } = useFlow();
  const [errors, setErrors] = useState<ReadonlySet<Field>>(new Set());
  const { send, failed } = useStep<Field>("signup");

  const clear = (field: Field) =>
    setErrors((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });

  // Submit stays clickable; every rule is re-checked on each submit and failures show inline.
  // The server re-validates; only an accepted signup advances.
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = new Set<Field>();
    if (!isFilled(flow.name)) next.add("name");
    if (!isEmail(flow.email)) next.add("email");
    if (flow.password.length < MIN_PASSWORD_LENGTH) next.add("password");
    if (!flow.consent) next.add("consent");
    setErrors(next);
    if (next.size > 0) return;
    const result = await send({ name: flow.name, email: flow.email, password: flow.password, consent: flow.consent });
    if (result?.kind === "invalid") setErrors(new Set(result.errors));
    if (result?.kind === "ok") go("workspace");
  };

  return (
    <Stage step={1}>
      <form className="card" style={{ minHeight: 460, padding: "36px 47px 52px" }} noValidate onSubmit={submit}>
        <Ordered>
          {{
            "signup.title": <Text id="signup.title" as="h1" className="title" />,
            "signup.helper": <Text id="signup.helper" className="helper" />,
            "signup.name": (
              <TextField
                id="signup.name"
                placeholder="Alex Kim"
                autoComplete="name"
                width={FIELD_WIDTH}
                value={flow.name}
                errorId={errors.has("name") ? "signup.name.error" : undefined}
                onChange={(name) => {
                  update({ name });
                  clear("name");
                }}
              />
            ),
            "signup.email": (
              <TextField
                id="signup.email"
                type="email"
                placeholder="alex@northwind.test"
                autoComplete="email"
                width={FIELD_WIDTH}
                value={flow.email}
                errorId={errors.has("email") ? "signup.email.error" : undefined}
                onChange={(email) => {
                  update({ email });
                  clear("email");
                }}
              />
            ),
            "signup.password": (
              <TextField
                id="signup.password"
                type="password"
                placeholder="At least 8 characters"
                autoComplete="new-password"
                width={FIELD_WIDTH}
                value={flow.password}
                errorId={errors.has("password") ? "signup.password.error" : undefined}
                onChange={(password) => {
                  update({ password });
                  clear("password");
                }}
              />
            ),
            "signup.consent": (
              <Checkbox
                id="signup.consent"
                checked={flow.consent}
                onChange={(consent) => {
                  update({ consent });
                  clear("consent");
                }}
              />
            ),
            "signup.consent.error": errors.has("consent") ? <FieldError id="signup.consent.error" /> : null,
            "signup.submit": <Button id="signup.submit" type="submit" />,
          }}
        </Ordered>
        <ApiError show={failed} />
      </form>
    </Stage>
  );
}
