import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../api";
import { Hardware, Project } from "../types";

export default function useHardware(token: string) {
  const [hardware, setHardware] = useState<Hardware[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const [result, projectResult] = await Promise.all([
        api<{ hardware: Hardware[] }>("/hardware", { signal: controller.signal }, token),
        api<{ projects: Project[] }>("/projects", { signal: controller.signal }, token),
      ]);
      if (controller.signal.aborted) return;
      setHardware(result.hardware);
      setProjects(projectResult.projects);
      setError("");
      setUpdatedAt(new Date());
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
    const refreshVisible = () => {
      // Do not repeatedly cancel a slow response when the poll interval elapses.
      if (document.visibilityState === "visible" && !activeRequest.current) void refresh();
    };
    const interval = window.setInterval(refreshVisible, 5000);
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      activeRequest.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  return { hardware, projects, loading, error, updatedAt, refresh };
}
