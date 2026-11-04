import { useState } from "react";
import { Hardware } from "../types";

export default function HardwareCard({ hardware, admin, managing, busy, checkoutReady, onCheckout, onReturn, onEdit, onRemove }: {
  hardware: Hardware;
  admin: boolean;
  managing: boolean;
  busy: boolean;
  checkoutReady: boolean;
  onCheckout: () => void;
  onReturn: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const available = hardware.status === "available";
  const borrower = hardware.checkedOutBy;
  return (
    <article className={`hardware-card ${hardware.isCheckedOutByMyProjects ? "hardware-mine" : ""}`} aria-labelledby={`hardware-${hardware.id}`}>
      <div className="resource-details">
        <span className="hardware-id">{hardware.hardwareId}</span>
        <h2 id={`hardware-${hardware.id}`}>{hardware.name}</h2>
        <p className="hardware-description">{hardware.description}</p>
      </div>
      <div className="resource-availability">
        <span className={`status-badge ${available ? "available" : "checked-out"}`}>
          <span aria-hidden="true" className="status-dot" />{available ? "Available" : "Checked out"}
        </span>
        <div className="card-assignment">
          {hardware.project ? <span>Project: {hardware.project.name}<br />{hardware.project.projectId}</span>
            : available ? <span>Ready to check out to a project</span> : null}
          {admin && borrower && <span className="borrower">Checked out by: {borrower.firstName} {borrower.lastName}<small>{borrower.email}</small></span>}
        </div>
      </div>
      {managing ? (
        <div className="card-actions management-actions">
          <button className="secondary" onClick={onEdit} disabled={busy}>Edit<span className="sr-only"> {hardware.name}</span></button>
          <button className="text-button danger-text" onClick={() => setConfirming(true)} disabled={busy || !available}
            title={!available ? "Return this hardware before removing it." : undefined}>
            Remove<span className="sr-only"> {hardware.name}</span>
          </button>
          {confirming && <div className="remove-confirmation" role="group" aria-label={`Confirm removal of ${hardware.name}`}>
            <p>Remove {hardware.name} from the library?</p>
            <button className="danger" disabled={busy || !available} onClick={onRemove}>Confirm removal</button>
            <button className="secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>}
        </div>
      ) : (
        <div className="card-actions">
          {hardware.canReturn ? (
            <button className="secondary" aria-label={`Return hardware: ${hardware.name}`} disabled={busy} onClick={onReturn}>Return hardware</button>
          ) : (
            <button aria-label={`${available ? "Check out" : "Unavailable"}: ${hardware.name}`} disabled={busy || !available || !checkoutReady} onClick={onCheckout} className={available ? "primary" : "unavailable-button"}
              title={available && !checkoutReady ? "Select a project you have joined before checking out." : undefined}>
              {available ? "Check out" : "Unavailable"}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
