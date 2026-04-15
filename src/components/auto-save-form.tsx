"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Wraps a server action with a top-right Save bar: secondary/muted until the
 * form is dirty, primary when unsaved, shows a spinner while submitting.
 * Saves preserve values (no redirect). Use via:
 *
 *   <AutoSaveForm action={updateX}>...fields...</AutoSaveForm>
 */
export function AutoSaveForm({
  action,
  children,
  className,
  extraActions,
}: {
  action: (fd: FormData) => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
  extraActions?: React.ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    startTransition(async () => {
      await action(fd);
      setDirty(false);
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-end gap-2">
        {extraActions}
        <Button
          type="button"
          onClick={submit}
          variant={dirty ? "default" : "secondary"}
          size="sm"
          disabled={pending || !dirty}
        >
          {pending ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onChange={() => setDirty(true)}
        className={cn(className)}
      >
        {children}
      </form>
    </>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
