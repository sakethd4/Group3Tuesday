import { useRef, useState } from "react";
import { api, errorMessage } from "../api";
import Brand from "../components/Brand";
import HardwareCard from "../components/HardwareCard";
import HardwareForm from "../components/HardwareForm";
import useHardware from "../hooks/useHardware";
import { Hardware, HardwareFields, Notice, Session } from "../types";

type View = "catalog" | "mine" | "manage";

export default function HardwarePage({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const { hardware, loading, error, updatedAt, refresh } = useHardware(session.token);
  const [view, setView] = useState<View>("catalog");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const [editor, setEditor] = useState<{ hardware: Hardware | null } | null>(null);
  const admin = session.user.role === "admin";
  const mine = hardware.filter((item) => item.isCheckedOutByMe);
  const visible = view === "mine" ? mine : hardware;
  const available = hardware.filter((item) => item.status === "available").length;

  function changeView(next: View) {
    setView(next);
    setEditor(null);
    setNotice(null);
  }

  async function act(item: Hardware, action: "checkout" | "return" | "remove") {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await api(`/hardware/${item.id}${action === "remove" ? "" : `/${action}`}`, { method: action === "remove" ? "DELETE" : "POST" }, session.token);
      setNotice({ type: "success", text: action === "checkout" ? `${item.name} is now checked out to you.`
        : action === "return" ? `${item.name} returned and available for another user.` : `${item.name} removed from the library.` });
    } catch (cause) {
      setNotice({ type: "error", text: errorMessage(cause) });
    } finally {
      await refresh();
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  async function save(fields: HardwareFields) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    try {
      await api(`/hardware${editor?.hardware ? `/${editor.hardware.id}` : ""}`, {
        method: editor?.hardware ? "PUT" : "POST", body: JSON.stringify(fields),
      }, session.token);
      setNotice({ type: "success", text: `${fields.name} ${editor?.hardware ? "updated" : "added to the library"}.` });
      setEditor(null);
    } finally {
      await refresh();
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="portal-shell">
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <div className="account-menu">
            <span className="avatar" aria-hidden="true">{session.user.firstName[0]}{session.user.lastName[0]}</span>
            <span className="account-name">{session.user.firstName} {session.user.lastName}<small>{admin ? "Administrator" : "Hardware user"}</small></span>
            <button className="text-button sign-out" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </header>
      <div className="portal-layout">
        <aside className="library-sidebar" aria-label="Library navigation and availability">
          <nav className="view-tabs" aria-label="Library views">
            <button aria-current={view === "catalog" ? "page" : undefined} onClick={() => changeView("catalog")} disabled={busy}>
              All hardware
            </button>
            <button aria-current={view === "mine" ? "page" : undefined} onClick={() => changeView("mine")} disabled={busy}>
              My checkouts <span>{mine.length}</span>
            </button>
            {admin && <button aria-current={view === "manage" ? "page" : undefined} onClick={() => changeView("manage")} disabled={busy}>
              Manage hardware
            </button>}
          </nav>
          <section className="inventory-summary" aria-label="Hardware availability overview">
            <div className="summary-total"><span>Total hardware</span><strong>{loading ? "—" : hardware.length}</strong></div>
            <div className="summary-available"><span>Available</span><strong>{loading ? "—" : available}</strong></div>
            <div><span>Checked out</span><strong>{loading ? "—" : hardware.length - available}</strong></div>
            <div><span>Checked out by you</span><strong>{loading ? "—" : mine.length}</strong></div>
          </section>
        </aside>
        <main className="portal-main">
          <div className="page-heading">
            <h1>{view === "mine" ? "My checkouts" : view === "manage" ? "Manage hardware" : "Hardware catalog"}</h1>
            <p className="page-copy">{view === "mine" ? "Everything you’re using. Return it here when you’re finished."
              : view === "manage" ? "Keep the library up to date and see who has each resource."
              : "Choose an available resource. Return it here when you’re finished."}</p>
          </div>
          <div className="catalog-toolbar">
            <div className={`refresh-indicator ${error ? "refresh-error" : ""}`}>
              <span className="status-dot" aria-hidden="true" />{error ? "Updates interrupted" : "Refreshes every 5 seconds"}
            </div>
            {view === "manage" && <button onClick={() => { setEditor({ hardware: null }); setNotice(null); }} disabled={busy}>+ Add hardware</button>}
          </div>
          {notice && <p role={notice.type === "error" ? "alert" : "status"} className={`message ${notice.type}`}>{notice.text}</p>}
          {error && <div className="message error" role="alert"><span>{error}{updatedAt && " Displaying the last known availability."}</span><button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
          {editor && <HardwareForm key={editor.hardware?.id ?? "new"} hardware={editor.hardware} onSave={save} onCancel={() => setEditor(null)} />}
          {loading ? <div className="empty-state" role="status">Loading hardware…</div>
            : visible.length ? <section className="hardware-grid" aria-label={view === "mine" ? "Your checked-out hardware" : "Hardware resources"} aria-busy={busy}>
              <div className="catalog-columns" aria-hidden="true"><span>Resource</span><span>Availability</span><span>Action</span></div>
              {visible.map((item) => <HardwareCard key={item.id} hardware={item} admin={admin} managing={view === "manage"}
                busy={busy || Boolean(editor)} onCheckout={() => void act(item, "checkout")} onReturn={() => void act(item, "return")}
                onEdit={() => { setEditor({ hardware: item }); setNotice(null); }} onRemove={() => void act(item, "remove")} />)}
            </section>
            : !error && <div className="empty-state">
              <h2>{view === "mine" ? "You’re all checked in" : "No hardware yet"}</h2>
              <p>{view === "mine" ? "Hardware you check out will appear here." : admin ? "Add hardware to make it available to your users." : "Your administrator hasn’t added any hardware yet."}</p>
              {view === "mine" && <button className="secondary" onClick={() => changeView("catalog")}>Browse hardware</button>}
            </div>}
          <footer className="catalog-footer"><span>{updatedAt ? `Last updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for availability"}</span></footer>
        </main>
      </div>
    </div>
  );
}
