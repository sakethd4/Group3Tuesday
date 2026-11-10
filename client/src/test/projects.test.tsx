import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HardwarePage from "../pages/HardwarePage";
import { Hardware, HistoryEvent, Project, Session } from "../types";

const session: Session = { token: "token", user: { id: "user", firstName: "Alex", lastName: "User", email: "alex@example.com", role: "user" } };
const robotics: Project = { id: "robotics", projectId: "ROBOT-1", name: "Robotics", description: "Build a robot", creatorId: "user", isCreator: true, isMember: true, memberCount: 1, hardwareCount: 0 };
const sensors: Project = { ...robotics, id: "sensors", projectId: "SENSOR-1", name: "Sensors", creatorId: "another", isCreator: false, isMember: false };
const board: Hardware = { id: "board", hardwareId: "HW-001", name: "Development board", description: "Shared board", status: "available", project: null, canReturn: false, isCheckedOutByMyProjects: false };
const fetchMock = vi.fn<typeof fetch>();
const reply = (data: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(data), { status }));

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("projects and checkout destinations", () => {
  it("requires creating or joining a project before checkout", async () => {
    const events = userEvent.setup();
    fetchMock.mockImplementation((url) => reply(String(url).endsWith("/projects") ? { projects: [] } : { hardware: [board] }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Check out: Development board" })).toBeDisabled();
    expect(screen.getByLabelText("Check out to project")).toBeDisabled();
    await events.click(screen.getByRole("button", { name: "Browse projects" }));
    expect(screen.getByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Create project" })).toBeEnabled();
  });

  it("creates a project, joins another, and checks out to the chosen project", async () => {
    const events = userEvent.setup();
    let projects = [sensors];
    let hardware = [board];
    fetchMock.mockImplementation((url, options) => {
      if (String(url) === "/api/projects" && options?.method === "POST") {
        expect(JSON.parse(String(options.body))).toEqual({ projectId: "ROBOT-1", name: "Robotics", description: "Build a robot" });
        projects = [...projects, robotics];
        return reply({ project: robotics }, 201);
      }
      if (String(url).endsWith("/sensors/join")) {
        projects = projects.map((p) => p.id === sensors.id ? { ...p, isMember: true, memberCount: 2 } : p);
        return reply({ project: projects[0] });
      }
      if (String(url).endsWith("/checkout")) {
        expect(JSON.parse(String(options?.body))).toEqual({ projectId: sensors.id });
        hardware = [{ ...board, project: sensors, status: "checked_out", canReturn: true, isCheckedOutByMyProjects: true }];
        return reply({ hardware: hardware[0] });
      }
      return reply(String(url).endsWith("/projects") ? { projects } : { hardware });
    });
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await events.click(await screen.findByRole("button", { name: "Browse projects" }));
    await events.click(screen.getByRole("button", { name: "+ Create project" }));
    await events.type(screen.getByLabelText("Project ID"), "ROBOT-1");
    await events.type(screen.getByLabelText("Project name"), "Robotics");
    await events.type(screen.getByLabelText("Description (optional)"), "Build a robot");
    await events.click(screen.getByRole("button", { name: "Save project" }));
    expect(await screen.findByText("Robotics created. You are a member.")).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Join project: Sensors" }));
    expect(await screen.findByText("You joined Sensors.")).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "All hardware" }));
    const select = screen.getByLabelText("Check out to project");
    expect(within(select).getAllByRole("option")).toHaveLength(3);
    expect(select).toHaveValue(sensors.id);
    await events.click(screen.getByRole("button", { name: "Check out: Development board" }));
    expect(await screen.findByText("Development board is now checked out to Sensors.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return hardware: Development board" })).toBeEnabled();
  });

  it("retains project form values when a unique ID conflicts", async () => {
    const events = userEvent.setup();
    fetchMock.mockImplementation((url, options) => options?.method === "POST"
      ? reply({ message: "A project with this project ID already exists." }, 409)
      : reply(String(url).endsWith("/projects") ? { projects: [robotics] } : { hardware: [] }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await screen.findByText("No hardware yet");
    await events.click(screen.getByRole("button", { name: /^Projects \d+$/ }));
    await events.click(screen.getByRole("button", { name: "+ Create project" }));
    await events.type(screen.getByLabelText("Project ID"), "ROBOT-1");
    await events.type(screen.getByLabelText("Project name"), "New team");
    await events.click(screen.getByRole("button", { name: "Save project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("project ID already exists");
    expect(screen.getByLabelText("Project name")).toHaveValue("New team");
    expect(screen.getByLabelText("Project ID")).toHaveValue("ROBOT-1");
  });

  it("separates the selected project's inventory from catalog availability and checkout controls", async () => {
    const events = userEvent.setup();
    const assigned: Hardware = { ...board, id: "assigned", hardwareId: "HW-002", name: "Project board", status: "checked_out", project: robotics, canReturn: true, isCheckedOutByMyProjects: true };
    const otherAssigned: Hardware = { ...board, id: "sensor-board", hardwareId: "HW-003", name: "Sensor board", status: "checked_out", project: sensors };
    fetchMock.mockImplementation((url) => reply(String(url).endsWith("/projects") ? { projects: [{ ...robotics, hardwareCount: 1 }, { ...sensors, hardwareCount: 1 }] } : { hardware: [board, assigned, otherAssigned] }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await screen.findByRole("heading", { name: board.name });
    expect(screen.queryByLabelText("Hardware assigned to")).not.toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(2);
    await events.selectOptions(screen.getByLabelText("Check out to project"), robotics.id);
    await events.selectOptions(screen.getByLabelText("Availability"), "available");
    expect(screen.getByRole("heading", { name: board.name })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: assigned.name })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: otherAssigned.name })).not.toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText("Availability"), "checked_out");
    expect(screen.queryByRole("heading", { name: board.name })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: assigned.name })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: otherAssigned.name })).toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText("Availability"), "all");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    await events.selectOptions(screen.getByLabelText("Availability"), "available");

    await events.click(screen.getByRole("button", { name: "Projects' Hardware" }));
    expect(screen.getByRole("heading", { name: "Projects' Hardware" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Select a project to view its hardware" })).toBeInTheDocument();
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByLabelText("Availability")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Check out to project")).not.toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText("Hardware assigned to"), robotics.id);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: assigned.name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return hardware: Project board" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /^Check out:/ })).not.toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText("Hardware assigned to"), sensors.id);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: otherAssigned.name })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Return hardware:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Assign more hardware" })).not.toBeInTheDocument();

    await events.click(screen.getByRole("button", { name: "All hardware" }));
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByLabelText("Hardware assigned to")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Check out to project")).toHaveValue(robotics.id);
    await events.click(screen.getByRole("button", { name: /^Projects \d+$/ }));
    expect(screen.getByRole("button", { name: "Delete project: Robotics" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Delete project: Sensors" })).not.toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "View hardware for Robotics" }));
    expect(screen.getByRole("heading", { name: "Projects' Hardware" })).toBeInTheDocument();
    expect(screen.getByLabelText("Hardware assigned to")).toHaveValue(robotics.id);
    expect(screen.getByRole("heading", { name: "Project board" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: board.name })).not.toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Assign more hardware" }));
    expect(screen.getByRole("button", { name: "All hardware" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("Hardware assigned to")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Availability")).toHaveValue("available");
    expect(screen.getByLabelText("Check out to project")).toHaveValue(robotics.id);
    expect(screen.getByRole("heading", { name: board.name })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Project board" })).not.toBeInTheDocument();
  });

  it("confirms deletion of a project created by the current user", async () => {
    const events = userEvent.setup();
    let projects = [robotics, sensors];
    fetchMock.mockImplementation((url, options) => {
      if (options?.method === "DELETE") {
        expect(String(url)).toBe("/api/projects/robotics");
        projects = [sensors];
        return reply(null, 204);
      }
      return reply(String(url).endsWith("/projects") ? { projects } : { hardware: [] });
    });
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await screen.findByText("No hardware yet");
    await events.click(screen.getByRole("button", { name: /^Projects \d+$/ }));
    await events.click(screen.getByRole("button", { name: "Delete project: Robotics" }));
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(0);
    const confirmation = screen.getByRole("group", { name: "Confirm deletion of Robotics" });
    await events.click(within(confirmation).getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Robotics" })).not.toBeInTheDocument());
    expect(screen.getByText("Robotics deleted. Checkout history has been kept.")).toBeInTheDocument();
  });

  it("disables project submissions while a save is pending", async () => {
    const events = userEvent.setup();
    let finish: (value: Response) => void = () => {};
    fetchMock.mockImplementation((url, options) => options?.method === "POST" ? new Promise((resolve) => { finish = resolve; })
      : reply(String(url).endsWith("/projects") ? { projects: [] } : { hardware: [] }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await screen.findByText("No hardware yet");
    await events.click(screen.getByRole("button", { name: /^Projects \d+$/ }));
    await events.click(screen.getByRole("button", { name: "+ Create project" }));
    await events.type(screen.getByLabelText("Project ID"), "ROBOT-1");
    await events.type(screen.getByLabelText("Project name"), "Robotics");
    await events.dblClick(screen.getByRole("button", { name: "Save project" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    await act(async () => finish(new Response(JSON.stringify({ project: robotics }), { status: 201 })));
  });
});

describe("checkout history", () => {
  const latest: HistoryEvent = { id: "event-2", action: "return", hardware: board, project: robotics, createdAt: "2026-11-03T12:00:00Z", isByMe: true };
  const older: HistoryEvent = { ...latest, id: "event-1", action: "checkout", isByMe: false };

  it("loads older events and filters history by project", async () => {
    const events = userEvent.setup();
    fetchMock.mockImplementation((url) => {
      const path = String(url);
      if (path.includes("/history?")) {
        if (path.includes("before=")) return reply({ history: [older], nextCursor: null });
        if (path.includes("project=sensors")) return reply({ history: [], nextCursor: null });
        return reply({ history: [latest], nextCursor: latest.id });
      }
      return reply(path.endsWith("/projects") ? { projects: [robotics, sensors] } : { hardware: [] });
    });
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await screen.findByText("No hardware yet");
    await events.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByRole("cell", { name: "Returned" })).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Load older events" }));
    expect(await screen.findByRole("cell", { name: "Checked out" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Project member" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load older events" })).not.toBeInTheDocument();
    await events.selectOptions(screen.getByLabelText("History for project"), sensors.id);
    expect(await screen.findByText("No checkout history yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("reports and retries history failures", async () => {
    const events = userEvent.setup();
    let failed = true;
    fetchMock.mockImplementation((url) => {
      if (String(url).includes("/history?")) return failed ? reply({ message: "Database is unavailable." }, 503) : reply({ history: [latest], nextCursor: null });
      return reply(String(url).endsWith("/projects") ? { projects: [robotics] } : { hardware: [] });
    });
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await screen.findByText("No hardware yet");
    await events.click(screen.getByRole("button", { name: "History" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Database is unavailable");
    failed = false;
    await events.click(screen.getByRole("button", { name: "Retry history" }));
    expect(await screen.findByRole("cell", { name: "Returned" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
