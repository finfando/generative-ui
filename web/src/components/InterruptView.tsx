// Interactive generative UI: the agent paused itself with interrupt(value),
// and `value` tells us which form to show. Same idea as the tool renderers in
// ToolCallView, but the component's job is to produce an *answer*.

import type { ReactNode } from "react";
import type { Interrupt } from "@ag-ui/client";
import { AddressForm } from "./AddressForm";

type Raw = { form?: string; message?: string };

type FormProps = {
  raw: Raw;
  resolve: (payload: unknown) => void;
  cancel: () => void;
};

const forms: Record<string, (p: FormProps) => ReactNode> = {
  address: ({ raw, resolve, cancel }) => (
    <AddressForm message={raw.message} onSubmit={resolve} onCancel={cancel} />
  ),
};

export function InterruptView({
  interrupt,
  onResume,
}: {
  interrupt: Interrupt;
  onResume: (status: "resolved" | "cancelled", payload?: unknown) => void;
}) {
  // The value passed to interrupt() in Python lives here:
  const raw = ((interrupt.metadata as { langgraph?: { raw?: unknown } })?.langgraph?.raw ??
    {}) as Raw;
  const render = raw.form ? forms[raw.form] : undefined;

  if (render)
    return (
      <>
        {render({
          raw,
          resolve: (payload) => onResume("resolved", payload),
          cancel: () => onResume("cancelled"),
        })}
      </>
    );

  // Unknown interrupt: offer a generic approve/reject.
  return (
    <div className="card form">
      <div className="form-title">The agent is waiting for you</div>
      <pre>{JSON.stringify(raw, null, 2)}</pre>
      <div className="form-actions">
        <button onClick={() => onResume("cancelled")}>Reject</button>
        <button type="submit" onClick={() => onResume("resolved", { approved: true })}>
          Approve
        </button>
      </div>
    </div>
  );
}
