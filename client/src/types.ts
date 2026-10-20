export type User = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "user" | "admin";
};

export type Session = { token: string; user: User };

export type Hardware = {
  id: string;
  hardwareId: string;
  name: string;
  description: string;
  status: "available" | "checked_out";
  isCheckedOutByMe: boolean;
  checkedOutBy?: User | null;
};

export type HardwareFields = Pick<Hardware, "hardwareId" | "name" | "description">;
export type Notice = { type: "success" | "error"; text: string };
