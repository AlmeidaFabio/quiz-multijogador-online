import type { ReactNode } from 'react';

type MessagePageProps = {
  icon: string;
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
};

export function MessagePage({ icon, eyebrow, title, description, children }: MessagePageProps) {
  return (
    <div className="center-panel">
      <div className="card message-card">
        <span className="large-icon">{icon}</span>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
        {children}
      </div>
    </div>
  );
}
