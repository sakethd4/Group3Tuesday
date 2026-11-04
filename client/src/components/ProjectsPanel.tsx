import { FormEvent, useState } from "react";
import { errorMessage } from "../api";
import { Project, ProjectFields } from "../types";

export default function ProjectsPanel({ projects, busy, onCreate, onJoin, onDelete, onView }: {
  projects: Project[];
  busy: boolean;
  onCreate: (fields: ProjectFields) => Promise<void>;
  onJoin: (project: Project) => void;
  onDelete: (project: Project) => void;
  onView: (project: Project) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const visible = projects.filter((project) => !onlyMine || project.isMember);

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
      <label className="checkbox-label"><input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />My projects only</label>
      <button disabled={busy} onClick={() => { setCreating(true); setError(""); }}>+ Create project</button>
    </div>
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
      </div>
      <div className="project-actions">
        <button className="secondary" disabled={busy} onClick={() => onView(project)}>View hardware<span className="sr-only"> for {project.name}</span></button>
        {!project.isMember && <button aria-label={`Join project: ${project.name}`} disabled={busy} onClick={() => onJoin(project)}>Join project</button>}
        {project.isCreator && <button aria-label={`Delete project: ${project.name}`} className="text-button" disabled={busy || project.hardwareCount > 0} onClick={() => setConfirming(project.id)}
          title={project.hardwareCount > 0 ? "Return this project's hardware before deleting it." : undefined}>Delete project</button>}
        {project.isCreator && project.hardwareCount > 0 && <small>Return assigned hardware to delete this project.</small>}
        {confirming === project.id && <div className="remove-confirmation" role="group" aria-label={`Confirm deletion of ${project.name}`}>
          <p>Delete {project.name}? Its checkout history will be kept.</p>
          <button disabled={busy || project.hardwareCount > 0} onClick={() => onDelete(project)}>Confirm deletion</button>
          <button className="secondary" disabled={busy} onClick={() => setConfirming(null)}>Cancel</button>
        </div>}
      </div>
    </article>)}</div> : <div className="empty-state"><h2>{onlyMine ? "No joined projects yet" : "No projects yet"}</h2><p>Create a project or join one to check out hardware.</p></div>}
  </section>;
}
