import { useRef, useState } from "react";
import { api, errorMessage } from "../api";
import Brand from "../components/Brand";
import HardwareCard from "../components/HardwareCard";
import HardwareForm from "../components/HardwareForm";
import ProjectsPanel from "../components/ProjectsPanel";
import HistoryPanel from "../components/HistoryPanel";
import useHardware from "../hooks/useHardware";
import { Hardware, HardwareFields, Notice, Project, ProjectFields, Session } from "../types";

type View = "catalog" | "projectHardware" | "manage" | "projects" | "history";

export default function HardwarePage({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const { hardware, projects, loading, error, updatedAt, refresh } = useHardware(session.token);
  const [view, setView] = useState<View>("catalog");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const [editor, setEditor] = useState<{ hardware: Hardware | null } | null>(null);
  const [checkoutProjectId, setCheckoutProjectId] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const admin = session.user.role === "admin";
  const mine = hardware.filter((item) => item.isCheckedOutByMyProjects);
  const joined = projects.filter((project) => project.isMember);
  const checkoutProject = joined.find((project) => project.id === checkoutProjectId);
  const selectedProject = projects.find((project) => project.id === projectFilter);
  const visible = hardware.filter((item) => view === "projectHardware"
    ? Boolean(selectedProject) && item.status === "checked_out" && item.project?.id === selectedProject?.id
    : (view !== "manage" || !projectFilter || item.project?.id === projectFilter)
      && (statusFilter === "all" || item.status === statusFilter));
  const available = hardware.filter((item) => item.status === "available").length;

  function changeView(next: View) {
    setView(next);
    setEditor(null);
    setNotice(null);
    setProjectFilter("");
    setStatusFilter("all");
  }

  async function act(item: Hardware, action: "checkout" | "return" | "remove") {
    if (mutationInFlight.current) return;
    if (action === "checkout" && !checkoutProject) {
      setNotice({ type: "error", text: "Select a project you have joined before checking out." });
      return;
    }
    mutationInFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await api(`/hardware/${item.id}${action === "remove" ? "" : `/${action}`}`, {
        method: action === "remove" ? "DELETE" : "POST",
        ...(action === "checkout" ? { body: JSON.stringify({ projectId: checkoutProject!.id }) } : {}),
      }, session.token);
      setNotice({ type: "success", text: action === "checkout" ? `${item.name} is now checked out to ${checkoutProject!.name}.`
        : action === "return" ? `${item.name} returned and available for another project.` : `${item.name} removed from the library.` });
    } catch (cause) {
      setNotice({ type: "error", text: errorMessage(cause) });
    } finally {
      await refresh();
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  async function createProject(fields: ProjectFields) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api<{ project: Project }>("/projects", { method: "POST", body: JSON.stringify(fields) }, session.token);
      setCheckoutProjectId(result.project.id);
      setNotice({ type: "success", text: `${result.project.name} created. You are a member.` });
    } finally {
      await refresh();
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  async function projectAction(project: Project, action: "join" | "delete") {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await api(`/projects/${project.id}${action === "join" ? "/join" : ""}`, { method: action === "join" ? "POST" : "DELETE" }, session.token);
      if (action === "join") setCheckoutProjectId(project.id);
      else if (checkoutProjectId === project.id) setCheckoutProjectId("");
      setNotice({ type: "success", text: action === "join" ? `You joined ${project.name}.` : `${project.name} deleted. Checkout history has been kept.` });
    } catch (cause) {
      setNotice({ type: "error", text: errorMessage(cause) });
    } finally {
      await refresh();
      mutationInFlight.current = false;
      setBusy(false);
    }
  }

  function viewProject(project: Project) {
    changeView("projectHardware");
    setProjectFilter(project.id);
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
            <button aria-current={view === "projectHardware" ? "page" : undefined} onClick={() => changeView("projectHardware")} disabled={busy}>
              Projects' Hardware
            </button>
            <button aria-current={view === "projects" ? "page" : undefined} onClick={() => changeView("projects")} disabled={busy}>Projects <span>{joined.length}</span></button>
            <button aria-current={view === "history" ? "page" : undefined} onClick={() => changeView("history")} disabled={busy}>History</button>
            {admin && <button aria-current={view === "manage" ? "page" : undefined} onClick={() => changeView("manage")} disabled={busy}>
              Manage hardware
            </button>}
          </nav>
          <section className="inventory-summary" aria-label="Hardware availability overview">
            <div className="summary-total"><span>Total hardware</span><strong>{loading ? "—" : hardware.length}</strong></div>
            <div className="summary-available"><span>Available</span><strong>{loading ? "—" : available}</strong></div>
            <div><span>Checked out</span><strong>{loading ? "—" : hardware.length - available}</strong></div>
            <div><span>With your projects</span><strong>{loading ? "—" : mine.length}</strong></div>
          </section>
        </aside>
        <main className="portal-main">
          <div className="page-heading">
            <h1>{view === "projectHardware" ? "Projects' Hardware" : view === "manage" ? "Manage hardware" : view === "projects" ? "Projects" : view === "history" ? "Checkout history" : "Hardware catalog"}</h1>
            <p className="page-copy">{view === "projectHardware" ? "Select a project to see its checked-out hardware. Any project member can return it when finished."
              : view === "manage" ? "Keep the library up to date and see which project has each resource."
              : view === "projects" ? "Create a project or join existing projects to share hardware with your team."
              : view === "history" ? "Review past hardware checkouts and returns by project."
              : "Choose a project and an available resource. Return it here when your project is finished."}</p>
          </div>
          {view !== "history" && <div className="catalog-toolbar">
            <div className={`refresh-indicator ${error ? "refresh-error" : ""}`}>
              <span className="status-dot" aria-hidden="true" />{error ? "Updates interrupted" : "Refreshes every 5 seconds"}
            </div>
            {view === "manage" && <button onClick={() => { setEditor({ hardware: null }); setNotice(null); }} disabled={busy}>+ Add hardware</button>}
          </div>}
          {notice && <p role={notice.type === "error" ? "alert" : "status"} className={`message ${notice.type}`}>{notice.text}</p>}
          {error && <div className="message error" role="alert"><span>{error}{updatedAt && " Displaying the last known availability."}</span><button className="text-button" onClick={() => void refresh()}>Retry</button></div>}
          {view === "history" ? <HistoryPanel token={session.token} projects={projects} />
            : loading ? <div className="empty-state" role="status">Loading library…</div>
            : view === "projects" ? <ProjectsPanel projects={projects} busy={busy} onCreate={createProject}
              onJoin={(project) => void projectAction(project, "join")} onDelete={(project) => void projectAction(project, "delete")} onView={viewProject} />
            : <>
          {view === "catalog" && <div className="checkout-project">
            <label>Check out to project<select value={checkoutProject?.id ?? ""} onChange={(event) => setCheckoutProjectId(event.target.value)} disabled={busy || !joined.length}>
              <option value="">Select a joined project</option>
              {joined.map((project) => <option value={project.id} key={project.id}>{project.projectId} — {project.name}</option>)}
            </select></label>
            {!joined.length && <p>Create or join a project before checking out hardware. <button className="text-button" onClick={() => changeView("projects")}>Browse projects</button></p>}
          </div>}
          <div className={`catalog-filters${view !== "manage" ? " single-filter" : ""}`}>
            {view !== "projectHardware" && <label>Availability<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} disabled={busy}>
              <option value="all">All statuses</option><option value="available">Available</option><option value="checked_out">Checked out</option>
            </select></label>}
            {view !== "catalog" && <label>Hardware assigned to<select value={selectedProject?.id ?? ""} onChange={(event) => setProjectFilter(event.target.value)} disabled={busy}>
              <option value="">{view === "projectHardware" ? "Select a project" : "All projects"}</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.projectId} — {project.name}</option>)}
            </select></label>}
          </div>
          {selectedProject && <p className="project-inventory-note">Hardware assigned to <strong>{selectedProject.name}</strong> is available for that project’s use.
            {selectedProject.isMember && <button className="text-button" disabled={busy} onClick={() => { changeView("catalog"); setCheckoutProjectId(selectedProject.id); setStatusFilter("available"); }}>Assign more hardware</button>}</p>}
          {editor && <HardwareForm key={editor.hardware?.id ?? "new"} hardware={editor.hardware} onSave={save} onCancel={() => setEditor(null)} />}
          {visible.length ? <section className="hardware-grid" aria-label={view === "projectHardware" ? "Projects' Hardware" : "Hardware resources"} aria-busy={busy}>
              <div className="catalog-columns" aria-hidden="true"><span>Resource</span><span>Availability</span><span>Action</span></div>
              {visible.map((item) => <HardwareCard key={item.id} hardware={item} admin={admin} managing={view === "manage"}
                busy={busy || Boolean(editor)} checkoutReady={view === "catalog" && Boolean(checkoutProject)} onCheckout={() => void act(item, "checkout")} onReturn={() => void act(item, "return")}
                onEdit={() => { setEditor({ hardware: item }); setNotice(null); }} onRemove={() => void act(item, "remove")} />)}
            </section>
            : !error && <div className="empty-state">
              <h2>{view === "projectHardware" ? selectedProject ? "No hardware checked out to this project" : "Select a project to view its hardware"
                : projectFilter || statusFilter !== "all" ? "No matching hardware" : "No hardware yet"}</h2>
              <p>{view === "projectHardware" ? selectedProject ? "Hardware checked out to this project will appear here." : "Choose a project using the Hardware assigned to dropdown."
                : projectFilter || statusFilter !== "all" ? "Choose another filter to see more hardware."
                : admin ? "Add hardware to make it available to your users." : "Your administrator hasn’t added any hardware yet."}</p>
              {view === "projectHardware" && <button className="secondary" onClick={() => changeView("catalog")}>Browse hardware</button>}
            </div>}
          </>}
          <footer className="catalog-footer"><span>{updatedAt ? `Last updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for availability"}</span></footer>
        </main>
      </div>
    </div>
  );
}
