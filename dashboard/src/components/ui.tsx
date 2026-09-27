import type { ReactNode } from "react";

export function PageHeader({ title, subtitle }: { title?: string; subtitle?: string }) {
  return (
    <div className="page-header">
      {title ? <h1 className="sr-only">{title}</h1> : null}
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className ? `card ${className}` : "card"}>
      {title ? <div className="card-title">{title}</div> : null}
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "ok" | "low" | "warn" | "due" | "danger" | "running" | "done" | string;
}) {
  const cls = tone && tone !== "default" ? `badge ${tone}` : "badge";
  return <span className={cls}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
