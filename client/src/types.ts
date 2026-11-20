export type User = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "user" | "admin";
};

export type Session = { token: string; user: User };

export type ProjectReference = { id: string; projectId: string; name: string };
export type ProjectMember = Pick<User, "id" | "firstName" | "lastName">;
export type Project = ProjectReference & {
  description: string;
  creatorId: string;
  isCreator: boolean;
  isMember: boolean;
  memberCount: number;
  hardwareCount: number;
  owner: ProjectMember | null;
  members: ProjectMember[];
};
export type ProjectFields = Pick<Project, "projectId" | "name" | "description">;

export type Hardware = {
  id: string;
  hardwareId: string;
  name: string;
  description: string;
  status: "available" | "checked_out";
  project: ProjectReference | null;
  isCheckedOutByMyProjects: boolean;
  canReturn: boolean;
  checkedOutAt?: string | null;
};

export type HistoryEvent = {
  id: string;
  action: "checkout" | "return" | "migrated_checkout";
  hardware: Pick<Hardware, "id" | "hardwareId" | "name">;
  project: ProjectReference;
  createdAt: string;
  isByMe: boolean;
};

export type HardwareFields = Pick<Hardware, "hardwareId" | "name" | "description">;
export type Notice = { type: "success" | "error"; text: string };
