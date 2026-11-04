import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { HistoryEvent, Project } from "../types";

export default function HistoryPanel({ token, projects }: { token: string; projects: Project[] }) {
  const [projectId, setProjectId] = useState("");
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);

  const load = useCallback(async (before?: string) => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("project", projectId);
      if (before) params.set("before", before);
      const result = await api<{ history: HistoryEvent[]; nextCursor: string | null }>(`/history?${params}`, { signal: controller.signal }, token);
      if (controller.signal.aborted) return;
      setEvents((previous) => before ? [...previous, ...result.history] : result.history);
      setCursor(result.nextCursor);
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [token, projectId]);

  useEffect(() => {
    setEvents([]);
    setCursor(null);
    void load();
    return () => active.current?.abort();
  }, [load]);

  return <section aria-label="Checkout history">
    <div className="catalog-toolbar">
      <label>History for project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
        <option value="">All projects (including deleted)</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.projectId} — {project.name}</option>)}
      </select></label>
      <button className="secondary" disabled={loading} onClick={() => void load()}>Refresh history</button>
    </div>
    {error && <div role="alert" className="message error"><span>{error} {events.length > 0 && "Displaying previously loaded history."}</span><button className="text-button" onClick={() => void load()}>Retry history</button></div>}
    {events.length > 0 && <div className="history-table-wrap"><table className="history-table">
      <caption className="sr-only">Hardware checkout and return events, newest first</caption>
      <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Hardware</th><th scope="col">Project</th><th scope="col">Recorded by</th></tr></thead>
      <tbody>{events.map((event) => <tr key={event.id}>
        <td><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></td>
        <td>{event.action === "checkout" ? "Checked out" : event.action === "return" ? "Returned" : "Imported checkout"}</td>
        <td>{event.hardware.name}<small>{event.hardware.hardwareId}</small></td>
        <td>{event.project.name}<small>{event.project.projectId}</small></td>
        <td>{event.actor ? `${event.actor.firstName} ${event.actor.lastName}` : event.isByMe ? "You" : "Project member"}</td>
      </tr>)}</tbody>
    </table></div>}
    {loading && <p role="status">Loading history…</p>}
    {!loading && !error && !events.length && <div className="empty-state"><h2>No checkout history yet</h2><p>Project checkouts and returns will appear here.</p></div>}
    {cursor && <button className="secondary history-more" disabled={loading} onClick={() => void load(cursor)}>Load older events</button>}
  </section>;
}
