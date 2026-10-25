import * as React from "react";

type Variant = "default" | "outline";

export function Button({ variant = "default", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button data-slot="button" className={`btn btn-${variant} ${className}`} {...props} />;
}
