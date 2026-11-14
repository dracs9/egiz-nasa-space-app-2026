import { t as localizeText, useLanguage } from '../i18n';
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadText } from "../lib/download";
import type { RunResult } from "./types";

export function ExperimentExport({
  run,
  onClose,
}: {
  run: RunResult;
  onClose(): void;
}) {
  useLanguage();
  const dialog = useRef<HTMLDialogElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [status, setStatus] = useState("");
  const archive = useMemo(() => JSON.stringify(run, null, 2), [run]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (dialog.current?.showModal) dialog.current.showModal();
    else dialog.current?.setAttribute("open", "");
    return () => previous?.focus();
  }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(archive);
      setStatus("Complete experiment JSON copied.");
    } catch {
      textarea.current?.focus();
      textarea.current?.select();
      setStatus(
        "Archive selected. Use your device’s Copy command, then save as a .json file.",
      );
    }
  };
  return (
    <dialog
      ref={dialog}
      className="ml-export-dialog"
      aria-labelledby="ml-export-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="ml-export-title">{localizeText("Export reproducible experiment")}</h2>
      <p>{localizeText("Complete inputs, measured terrain, telemetry and provenance. Save this JSON file, then use Import & reproduce to calculate it again.")}</p>
      <p>
        <code>egiz-{run.id}.json</code> ·{localizeText(" ")}
        {localizeText((new Blob([archive]).size / 1024).toFixed(0))}{localizeText(" KB")}</p>
      <textarea
        ref={textarea}
        aria-label={localizeText("Complete experiment JSON")}
        readOnly
        value={archive}
        spellCheck={false}
      />
      <div className="ml-export-dialog-actions">
        <button
          onClick={() =>
            downloadText(archive, `egiz-${run.id}.json`, "application/json")
          }
        >{localizeText("Download JSON")}</button>
        <button onClick={copy}>{localizeText("Copy complete JSON")}</button>
        <button onClick={onClose}>{localizeText("Close JSON export")}</button>
      </div>
      <p role="status">
        {localizeText(status ||
          "If this browser cannot save downloads, copy the complete archive or select its text.")}
      </p>
    </dialog>
  );
}
