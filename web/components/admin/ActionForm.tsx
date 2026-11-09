"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";

/** What a console server action returns: a short confirmation or the problems found. */
export type ActionState = { ok?: string; errors?: string[] } | null;

/**
 * A form that runs a server action and shows its result next to the button, without
 * clearing what the admin typed when something is wrong. `confirm` asks first.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel = "Saving…",
  submitClassName = "btn btn-dark btn-sm",
  className = "adm-form",
  confirm,
  resetOnSuccess = false,
  extraButtons,
}: {
  action: (fd: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  className?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
  extraButtons?: ReactNode;
}) {
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const form = e.currentTarget;
        const fd = new FormData(form);
        startTransition(async () => {
          try {
            const res = await action(fd);
            setState(res);
            if (res?.ok && resetOnSuccess) form.reset();
          } catch {
            setState({ errors: ["Something went wrong. Please try again."] });
          }
        });
      }}
    >
      {children}
      <div className="adm-form-foot">
        <button type="submit" className={submitClassName} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {extraButtons}
        <span aria-live="polite" className="adm-form-status">
          {!pending && state?.ok && <span className="adm-ok">{state.ok}</span>}
        </span>
      </div>
      {!pending && state?.errors && state.errors.length > 0 && (
        <ul className="adm-errors" role="alert">
          {state.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
