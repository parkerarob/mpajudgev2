'use client';

import { useFormStatus } from 'react-dom';

type SubmitButtonProps = {
  idleLabel: string;
  pendingLabel: string;
  name?: string;
  value?: string;
  className?: string;
};

export function SubmitButton({ idleLabel, pendingLabel, name, value, className }: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button className={className ?? 'button'} type="submit" disabled={pending} name={name} value={value}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}
