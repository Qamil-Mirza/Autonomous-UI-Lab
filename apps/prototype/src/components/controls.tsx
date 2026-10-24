import { Fragment, type ChangeEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { tokenClass, useEl, useOrdered } from "../manifest/context";
import type { ElementId } from "../manifest/ids";
import { useScreenPath, type Screen } from "../state/flow";

function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

// Renders a group's children in manifest order, dropping elements the manifest hides.
export function Ordered({ children }: { children: Partial<Record<ElementId, ReactNode>> }) {
  const ids = useOrdered(Object.keys(children) as ElementId[]);
  return (
    <>
      {ids.map((id) => (
        <Fragment key={id}>{children[id]}</Fragment>
      ))}
    </>
  );
}

export function Text({ id, as: Tag = "p", className }: { id: ElementId; as?: "h1" | "p"; className: string }) {
  const el = useEl(id);
  if (!el.visible) return null;
  return (
    <Tag className={cx(className, tokenClass(el.styleToken))} data-testid={el.testId}>
      {el.label}
    </Tag>
  );
}

export function Button({
  id,
  type = "button",
  onClick,
  minWidth,
  className,
}: {
  id: ElementId;
  type?: "button" | "submit";
  onClick?: () => void;
  minWidth?: number;
  className?: string;
}) {
  const el = useEl(id);
  if (!el.visible) return null;
  return (
    <button
      type={type}
      className={cx("btn", tokenClass(el.styleToken ?? "button.primary"), className)}
      style={minWidth ? { minWidth } : undefined}
      onClick={onClick}
      data-testid={el.testId}
    >
      {el.label}
    </button>
  );
}

export function TextField({
  id,
  type = "text",
  placeholder,
  value,
  onChange,
  width,
  autoComplete,
  errorId,
}: {
  id: ElementId;
  type?: "text" | "email" | "password";
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  width: number;
  autoComplete?: string;
  // Set while the field is invalid: the error element to show beneath the input.
  errorId?: ElementId;
}) {
  const el = useEl(id);
  if (!el.visible) return null;
  return (
    <div className="field">
      <label className={cx("field-label", tokenClass(el.styleToken))} htmlFor={el.testId}>
        {el.label}
      </label>
      <input
        id={el.testId}
        className="field-input"
        style={{ width }}
        type={type}
        placeholder={placeholder}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        data-testid={el.testId}
      />
      {errorId && <FieldError id={errorId} />}
    </div>
  );
}

export function BackLink({ id, to }: { id: ElementId; to: Screen }) {
  const el = useEl(id);
  const pathTo = useScreenPath();
  if (!el.visible) return null;
  return (
    <Link className={cx("back-link", tokenClass(el.styleToken))} to={pathTo(to)} data-testid={el.testId}>
      {/* Arrow is decoration from the Figma design; the manifest label stays the accessible name. */}
      <span aria-hidden="true">←</span>
      {el.label}
    </Link>
  );
}

export function Checkbox({ id, checked, onChange }: { id: ElementId; checked: boolean; onChange: (checked: boolean) => void }) {
  const el = useEl(id);
  if (!el.visible) return null;
  return (
    <label className={cx("checkbox", tokenClass(el.styleToken))}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={el.testId} />
      <span>{el.label}</span>
    </label>
  );
}

export function FieldError({ id }: { id: ElementId }) {
  const el = useEl(id);
  if (!el.visible) return null;
  return (
    <p id={el.testId} className="field-error" role="alert" data-testid={el.testId}>
      {el.label}
    </p>
  );
}
