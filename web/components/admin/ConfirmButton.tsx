"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** A submit button that asks first (e.g. before deleting). */
export function ConfirmButton({ message, className, children, formAction }: { message: string; className?: string; children: ReactNode; formAction?: (fd: FormData) => void | Promise<void> }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
