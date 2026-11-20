import { FormEvent, useState } from "react";
import { errorMessage } from "../api";
import { Project, ProjectFields } from "../types";

export default function ProjectsPanel({ projects, busy, onCreate, onJoin, onDelete, onView }: {
  projects: Project[];
  busy: boolean;
  onCreate: (fields: ProjectFields) => Promise<void>;
  onJoin: (projectId: string) => Promise<void>;
  onDelete: (project: Project) => void;
  onView: (project: Project) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [joinId, setJoinId] = useState("");
  const [joinError, setJoinError] = useState("");
  const visible = projects.filter((project) => project.isMember);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !joinId.trim()) return;
    setJoinError("");
    try {
      await onJoin(joinId.trim());
      setJoinId("");
    } catch (cause) {
      setJoinError(errorMessage(cause));
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setError("");
    try {
      await onCreate({ projectId: String(data.get("projectId")), name: String(data.get("name")), description: String(data.get("description")) });
      setCreating(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return <section aria-label="Projects">
    <div className="catalog-toolbar">
      <span>My projects</span>
      <button disabled={busy} onClick={() => { setCreating(true); setError(""); }}>+ Create project</button>
    </div>
    <section className="hardware-editor" aria-labelledby="join-project-title">
      <h2 id="join-project-title">Join a project</h2>
      <form className="form-stack" onSubmit={join}>
        <label>Project ID to join<input name="joinProjectId" value={joinId} onChange={(event) => setJoinId(event.target.value)} maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" placeholder="Enter the project ID" required disabled={busy} /></label>
        <p className="field-hint">Ask the project owner for its ID. Only projects you belong to appear here.</p>
        {joinError && <p className="message error" role="alert">{joinError}</p>}
        <div className="form-actions"><button disabled={busy || !joinId.trim()}>Join project</button></div>
      </form>
    </section>
    {creating && <section className="hardware-editor" aria-labelledby="project-editor-title">
      <h2 id="project-editor-title">Create project</h2>
      <form className="form-stack" onSubmit={submit}>
        <div className="two-column">
          <label>Project ID<input autoFocus name="projectId" maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_\-]*" placeholder="PROJECT-001" required /></label>
          <label>Project name<input name="name" maxLength={120} required /></label>
        </div>
        <p className="field-hint">Project IDs are unique and are saved in uppercase.</p>
        <label>Description (optional)<textarea name="description" maxLength={2000} rows={3} /></label>
        {error && <p className="message error" role="alert">{error}</p>}
        <div className="form-actions">
          <button disabled={busy}>{busy ? "Saving…" : "Save project"}</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => setCreating(false)}>Cancel</button>
        </div>
      </form>
    </section>}
    {visible.length ? <div className="project-list">{visible.map((project) => <article className="project-card" key={project.id} aria-labelledby={`project-${project.id}`}>
      <div>
        <span className="hardware-id">{project.projectId}</span>
        <h2 id={`project-${project.id}`}>{project.name}</h2>
        <p className="hardware-description">{project.description}</p>
        <p className="project-meta">{project.isCreator ? "Created by you · " : project.isMember ? "Member · " : ""}{project.memberCount} {project.memberCount === 1 ? "member" : "members"} · {project.hardwareCount} hardware assigned</p>
        <p className="project-meta">Owner: {project.owner ? `${project.owner.firstName} ${project.owner.lastName}` : "Account unavailable"}</p>
        <p className="project-meta">Members: {project.members.map((member) => `${member.firstName} ${member.lastName}`).join(", ")}</p>
      </div>
      <div className="project-actions">
        <button className="secondary" disabled={busy} onClick={() => onView(project)}>View hardware<span className="sr-only"> for {project.name}</span></button>
        {project.isCreator && <button aria-label={`Delete project: ${project.name}`} className="text-button" disabled={busy || project.hardwareCount > 0} onClick={() => setConfirming(project.id)}
          title={project.hardwareCount > 0 ? "Return this project's hardware before deleting it." : undefined}>Delete project</button>}
        {project.isCreator && project.hardwareCount > 0 && <small>Return assigned hardware to delete this project.</small>}
        {confirming === project.id && <div className="remove-confirmation" role="group" aria-label={`Confirm deletion of ${project.name}`}>
          <p>Delete {project.name}? Its checkout history will be kept.</p>
          <button disabled={busy || project.hardwareCount > 0} onClick={() => onDelete(project)}>Confirm deletion</button>
          <button className="secondary" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
        </div>}
      </div>
    </article>)}</div> : <div className="empty-state"><h2>No projects yet</h2><p>Create a project or enter a project ID above to join one.</p></div>}
  </section>;
}
