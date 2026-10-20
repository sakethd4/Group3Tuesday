import { FormEvent, useState } from "react";
import { Hardware, HardwareFields } from "../types";
import { errorMessage } from "../api";

export default function HardwareForm({ hardware, onSave, onCancel }: {
  hardware: Hardware | null;
  onSave: (fields: HardwareFields) => Promise<void>;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await onSave({ hardwareId: String(data.get("hardwareId")), name: String(data.get("name")), description: String(data.get("description")) });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="hardware-editor" aria-labelledby="editor-title">
      <div className="editor-heading"><h2 id="editor-title">{hardware ? "Edit hardware" : "Add hardware"}</h2>
        <p>Each entry represents one hardware resource.</p></div>
      <form className="form-stack" onSubmit={submit}>
        <div className="two-column">
          <label>Hardware ID<input autoFocus name="hardwareId" defaultValue={hardware?.hardwareId} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" placeholder="HW-007" required /></label>
          <label>Hardware name<input name="name" defaultValue={hardware?.name} maxLength={120} required /></label>
        </div>
        <label>Description<textarea name="description" defaultValue={hardware?.description} maxLength={2000} rows={3} required /></label>
        {error && <p className="message error" role="alert">{error}</p>}
        <div className="form-actions">
          <button disabled={pending}>{pending ? "Saving…" : "Save hardware"}</button>
          <button className="secondary" type="button" onClick={onCancel} disabled={pending}>Cancel</button>
        </div>
      </form>
    </section>
  );
}
