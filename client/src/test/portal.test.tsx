import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { SESSION_KEY } from "../api";
import HardwarePage from "../pages/HardwarePage";
import LoginPage from "../pages/LoginPage";
import RegistrationPage from "../pages/RegistrationPage";
import { Hardware, Project, Session, User } from "../types";

const user: User = { id: "user-1", firstName: "Alex", lastName: "User", email: "alex@example.com", role: "user" };
const session: Session = { token: "test-jwt", user };
const admin: Session = { token: "admin-jwt", user: { ...user, id: "admin-1", role: "admin" } };
const project: Project = { id: "project-1", projectId: "PROJ-001", name: "Robotics", description: "Team project", creatorId: user.id, isCreator: true, isMember: true, memberCount: 1, hardwareCount: 0, owner: user, members: [user] };
const first: Hardware = { id: "resource-1", hardwareId: "HW-001", name: "Hardware 1", description: "Shared hardware resource 1.", status: "available", isCheckedOutByMyProjects: false, canReturn: false, project: null };
const second: Hardware = { id: "resource-2", hardwareId: "HW-002", name: "Hardware 2", description: "Shared hardware resource 2.", status: "checked_out", isCheckedOutByMyProjects: false, canReturn: false, project: null };
const fetchMock = vi.fn<typeof fetch>();
const reply = (data: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("account forms", () => {
  it("signs in with credentials and displays server errors", async () => {
    const events = userEvent.setup();
    const onLogin = vi.fn();
    fetchMock.mockImplementationOnce(() => reply({ message: "Email or password is incorrect." }, 401))
      .mockImplementationOnce(() => reply(session));
    render(<LoginPage onLogin={onLogin} onRegister={vi.fn()} message="" />);
    await events.type(screen.getByLabelText("Email"), user.email);
    await events.type(screen.getByLabelText("Password"), "LibraryPass123");
    await events.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(onLogin).not.toHaveBeenCalled();
    await events.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(session));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/login", expect.objectContaining({
      method: "POST", body: JSON.stringify({ email: user.email, password: "LibraryPass123" }),
    }));
  });

  it("validates matching registration passwords and creates a regular account", async () => {
    const events = userEvent.setup();
    const onRegister = vi.fn();
    fetchMock.mockImplementation(() => reply(session, 201));
    render(<RegistrationPage onRegister={onRegister} onLogin={vi.fn()} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await events.type(screen.getByLabelText("First name"), "Alex");
    await events.type(screen.getByLabelText("Last name"), "User");
    await events.type(screen.getByLabelText("Email"), user.email);
    await events.type(screen.getByLabelText("Password", { exact: true }), "LibraryPass123");
    await events.type(screen.getByLabelText("Confirm password"), "Different123");
    await events.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords must match.");
    expect(fetchMock).not.toHaveBeenCalled();
    await events.clear(screen.getByLabelText("Confirm password"));
    await events.type(screen.getByLabelText("Confirm password"), "LibraryPass123");
    await events.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(onRegister).toHaveBeenCalledWith(session));
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload).not.toHaveProperty("role");
    expect(payload.email).toBe(user.email);
  });

  it("reports an unreachable login service", async () => {
    const events = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<LoginPage onLogin={vi.fn()} onRegister={vi.fn()} message="" />);
    await events.type(screen.getByLabelText("Email"), user.email);
    await events.type(screen.getByLabelText("Password"), "LibraryPass123");
    await events.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});

describe("hardware workflows", () => {
  it("shows available resources and hides other checkouts", async () => {
    fetchMock.mockImplementation(() => reply({ projects: [project], hardware: [first, second] }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: "Hardware 1" })).toBeInTheDocument();
    expect(screen.getByText("HW-001")).toBeInTheDocument();
    expect(screen.getByText(first.description)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Check out to project"), { target: { value: project.id } });
    expect(screen.getByRole("button", { name: "Check out: Hardware 1" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Hardware 2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage hardware" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/hardware", expect.objectContaining({ headers: { Authorization: "Bearer test-jwt" } }));
  });

  it("checks out hardware, shows the selected project's checkouts, and returns it", async () => {
    const events = userEvent.setup();
    let resources = [{ ...first }, { ...second }];
    fetchMock.mockImplementation((url, options) => {
      if (String(url).endsWith("/checkout")) {
        expect(options?.method).toBe("POST");
        expect(JSON.parse(String(options?.body))).toEqual({ projectId: project.id });
        resources = [{ ...first, status: "checked_out", isCheckedOutByMyProjects: true, canReturn: true, project }, second];
        return reply({ projects: [project], hardware: resources[0] });
      }
      if (String(url).endsWith("/return")) {
        resources = [first, second];
        return reply({ projects: [project], hardware: first });
      }
      return reply({ projects: [project], hardware: resources });
    });
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await events.selectOptions(await screen.findByLabelText("Check out to project"), project.id);
    await events.click(await screen.findByRole("button", { name: "Check out: Hardware 1" }));
    expect(await screen.findByText("Hardware 1 is now checked out to Robotics.")).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Projects' Hardware" }));
    await events.selectOptions(screen.getByLabelText("Hardware assigned to"), project.id);
    expect(screen.queryByRole("heading", { name: "Hardware 2" })).not.toBeInTheDocument();
    await events.click(await screen.findByRole("button", { name: "Return hardware: Hardware 1" }));
    expect(await screen.findByText("Hardware 1 returned and available for another project.")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "No hardware checked out to this project" })).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Browse hardware" }));
    expect(await screen.findByRole("button", { name: "Check out: Hardware 1" })).toBeEnabled();
  });

  it("refreshes availability when another user wins checkout", async () => {
    const events = userEvent.setup();
    let item = first;
    fetchMock.mockImplementation((url) => {
      if (String(url).endsWith("/checkout")) {
        item = { ...first, status: "checked_out" };
        return reply({ message: "This hardware is already checked out." }, 409);
      }
      return reply({ projects: [project], hardware: [item] });
    });
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await events.selectOptions(await screen.findByLabelText("Check out to project"), project.id);
    await events.click(await screen.findByRole("button", { name: "Check out: Hardware 1" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already checked out");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Hardware 1" })).not.toBeInTheDocument());
  });

  it("prevents repeated checkout submissions while a request is pending", async () => {
    const events = userEvent.setup();
    let finish: (value: Response) => void = () => {};
    fetchMock.mockImplementation((url) => String(url).endsWith("/checkout")
      ? new Promise((resolve) => { finish = resolve; }) : reply({ projects: [project], hardware: [first] }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await events.selectOptions(await screen.findByLabelText("Check out to project"), project.id);
    const button = await screen.findByRole("button", { name: "Check out: Hardware 1" });
    await events.dblClick(button);
    expect(button).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/checkout"))).toHaveLength(1);
    await act(async () => finish(new Response(JSON.stringify({ hardware: first }), { status: 200 })));
  });

  it("automatically refreshes availability every five seconds", async () => {
    vi.useFakeTimers();
    let item = first;
    fetchMock.mockImplementation(() => reply({ projects: [project], hardware: [item] }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fireEvent.change(screen.getByLabelText("Check out to project"), { target: { value: project.id } });
    expect(screen.getByRole("button", { name: "Check out: Hardware 1" })).toBeEnabled();
    item = { ...first, status: "checked_out" };
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole("heading", { name: "Hardware 1" })).not.toBeInTheDocument();
  });

  it("allows a slow availability request to finish instead of aborting it on every poll", async () => {
    vi.useFakeTimers();
    let finish: (value: Response) => void = () => {};
    fetchMock.mockImplementation((url) => String(url).endsWith("/projects") ? reply({ projects: [project] }) : new Promise((resolve) => { finish = resolve; }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await act(async () => finish(new Response(JSON.stringify({ hardware: [first] }), { status: 200 })));
    expect(screen.getByRole("heading", { name: "Hardware 1" })).toBeInTheDocument();
  });

  it("reports availability failures and retries", async () => {
    const events = userEvent.setup();
    fetchMock.mockImplementationOnce(() => reply({ message: "Database is unavailable." }, 503))
      .mockImplementation(() => reply({ projects: [project], hardware: [first] }));
    render(<HardwarePage session={session} onSignOut={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Database is unavailable.");
    await events.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: "Hardware 1" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets administrators manage hardware without seeing borrowers", async () => {
    const events = userEvent.setup();
    let resources: Hardware[] = [second];
    fetchMock.mockImplementation((url, options) => {
      if (options?.method === "POST") {
        const fields = JSON.parse(String(options.body));
        resources = [...resources, { ...first, ...fields }];
        return reply({ projects: [project], hardware: resources[1] }, 201);
      }
      if (options?.method === "PUT") {
        const fields = JSON.parse(String(options.body));
        resources = [resources[0], { ...resources[1], ...fields }];
        return reply({ projects: [project], hardware: resources[1] });
      }
      if (options?.method === "DELETE") {
        expect(String(url)).toBe("/api/hardware/resource-1");
        resources = [resources[0]];
        return reply(null, 204);
      }
      return reply({ projects: [project], hardware: resources });
    });
    render(<HardwarePage session={admin} onSignOut={vi.fn()} />);
    await screen.findByText("No hardware available");
    expect(screen.queryByText(/Checked out by:/)).not.toBeInTheDocument();
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Manage hardware" }));
    expect(screen.getByRole("button", { name: "Remove Hardware 2" })).toBeDisabled();
    await events.click(screen.getByRole("button", { name: "+ Add hardware" }));
    await events.type(screen.getByLabelText("Hardware ID"), "HW-003");
    await events.type(screen.getByLabelText("Hardware name"), "Hardware 3");
    await events.type(screen.getByLabelText("Description"), "A shared resource.");
    await events.click(screen.getByRole("button", { name: "Save hardware" }));
    expect(await screen.findByRole("heading", { name: "Hardware 3" })).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Edit Hardware 3" }));
    await events.clear(screen.getByLabelText("Hardware name"));
    await events.type(screen.getByLabelText("Hardware name"), "Renamed hardware");
    await events.click(screen.getByRole("button", { name: "Save hardware" }));
    expect(await screen.findByRole("heading", { name: "Renamed hardware" })).toBeInTheDocument();
    await events.click(screen.getByRole("button", { name: "Remove Renamed hardware" }));
    const confirmation = screen.getByRole("group", { name: "Confirm removal of Renamed hardware" });
    await events.click(within(confirmation).getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Renamed hardware" })).not.toBeInTheDocument());
  });

  it("keeps administrator form values when saving fails", async () => {
    const events = userEvent.setup();
    fetchMock.mockImplementation((_url, options) => options?.method === "POST"
      ? reply({ message: "A resource with this hardware ID already exists." }, 409)
      : reply({ projects: [project], hardware: [] }));
    render(<HardwarePage session={admin} onSignOut={vi.fn()} />);
    await screen.findByText("No hardware available");
    await events.click(screen.getByRole("button", { name: "Manage hardware" }));
    await events.click(screen.getByRole("button", { name: "+ Add hardware" }));
    await events.type(screen.getByLabelText("Hardware ID"), "HW-001");
    await events.type(screen.getByLabelText("Hardware name"), "Hardware 1");
    await events.type(screen.getByLabelText("Description"), "Shared resource.");
    await events.click(screen.getByRole("button", { name: "Save hardware" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByLabelText("Hardware name")).toHaveValue("Hardware 1");
  });
});

describe("session lifecycle", () => {
  it("signs in, retains the JWT for this tab, and signs out", async () => {
    const events = userEvent.setup();
    fetchMock.mockImplementation((url) => String(url).endsWith("/login") ? reply(session) : reply({ projects: [project], hardware: [] }));
    render(<App />);
    await events.type(screen.getByLabelText("Email"), user.email);
    await events.type(screen.getByLabelText("Password"), "LibraryPass123");
    await events.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Hardware catalog" })).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem(SESSION_KEY)!)).toEqual(session);
    await events.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("clears an expired saved session and asks the user to sign in", async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    fetchMock.mockImplementation(() => reply({ message: "Session expired." }, 401));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your session has expired");
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("retries session validation without discarding a valid login on network failure", async () => {
    const events = userEvent.setup();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    fetchMock.mockRejectedValueOnce(new TypeError("Offline"))
      .mockImplementation((url) => String(url).endsWith("/me") ? reply({ user }) : reply({ projects: [project], hardware: [] }));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server");
    expect(sessionStorage.getItem(SESSION_KEY)).not.toBeNull();
    await events.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Hardware catalog" })).toBeInTheDocument();
  });
});
