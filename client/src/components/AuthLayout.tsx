import { ReactNode } from "react";
import Brand from "./Brand";

export default function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <Brand />
        <h2 id="auth-title">{title}</h2>
        {children}
      </section>
    </main>
  );
}
