"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { setPlaythroughReferenceMap } from "./playthrough-reference-actions";

function generateStoragePath(file: File): string {
  // Use a stable filename so replacements overwrite the previous upload.
  const ext = file.name.split(".").pop() ?? "png";
  return `map.${ext}`;
}

export function PlaythroughReferenceSection({
  currentUrl,
}: {
  currentUrl: string | null;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "success"; message: string }
    | { kind: "error"; error: string }
  >({ kind: "idle" });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    startTransition(async () => {
      setStatus({ kind: "idle" });
      try {
        const supabase = createSupabaseBrowserClient();
        const path = generateStoragePath(file);

        // Upsert — remove then insert so we get the public URL of the new file.
        await supabase.storage.from("playthrough-reference").remove([path]);

        const { error: uploadError } = await supabase.storage
          .from("playthrough-reference")
          .upload(path, file, { upsert: true });

        if (uploadError) {
          throw new Error(`Upload failed: ${uploadError.message}`);
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("playthrough-reference").getPublicUrl(path);

        // Bust the CDN cache with a timestamp query param so the preview
        // actually refreshes without a full page reload.
        const bustedUrl = `${publicUrl}?t=${Date.now()}`;

        await setPlaythroughReferenceMap(bustedUrl);
        setPreviewUrl(bustedUrl);
        setStatus({ kind: "success", message: "Reference map updated." });
      } catch (e) {
        const error =
          e instanceof Error ? e.message : "Failed to upload reference map";
        setStatus({ kind: "error", error });
      } finally {
        // Reset the input so re-selecting the same file fires onChange again.
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  async function handleRemove() {
    startTransition(async () => {
      setStatus({ kind: "idle" });
      try {
        await setPlaythroughReferenceMap(null);
        setPreviewUrl(null);
        setStatus({ kind: "success", message: "Reference map removed." });
      } catch (e) {
        const error =
          e instanceof Error ? e.message : "Failed to remove reference map";
        setStatus({ kind: "error", error });
      }
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {previewUrl ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Reference map preview"
            className="max-h-48 w-auto rounded-md border border-border object-contain"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => fileInputRef.current?.click()}
            >
              {pending ? "Uploading…" : "Replace"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={handleRemove}
              className="text-destructive hover:text-destructive"
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center rounded-md border border-dashed border-border px-6 py-8 text-sm text-muted-foreground">
            No reference map uploaded yet.
          </div>
          <div className="flex items-end gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="reference-map-upload">Map image</Label>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => fileInputRef.current?.click()}
                className="w-fit"
              >
                {pending ? "Uploading…" : "Upload image"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        id="reference-map-upload"
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFileChange}
        disabled={pending}
      />

      {status.kind === "success" ? (
        <p className="rounded-md bg-success/15 px-3 py-2 text-sm text-success">
          {status.message}
        </p>
      ) : null}
      {status.kind === "error" ? (
        <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
          {status.error}
        </p>
      ) : null}
    </div>
  );
}
