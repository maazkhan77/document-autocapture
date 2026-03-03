import type { ReactNode } from 'react';
import { CodeSnippet } from './CodeSnippet';

interface IntegrationSnippet {
  title: string;
  code: string;
  language?: string;
}

interface IntegrationShellProps {
  title: string;
  subtitle: string;
  description: string;
  children: ReactNode;
  snippets: IntegrationSnippet[];
}

export function IntegrationShell({
  title,
  subtitle,
  description,
  children,
  snippets,
}: IntegrationShellProps) {
  return (
    <main className="integration-shell">
      <header className="studio-bar integration-topbar">
        <div className="studio-brand">
          <h1>document-autocapture</h1>
          <p>{subtitle}</p>
        </div>
        <nav className="integration-nav" aria-label="Demo pages">
          <a href="/">Studio</a>
          <a href="/react">React</a>
          <a href="/js">JS</a>
        </nav>
      </header>

      <section className="integration-body">
        <article className="panel integration-primary">
          <div className="panel-title-row">
            <h2>{title}</h2>
            <span className="chip">Live demo</span>
          </div>
          <p className="integration-description">{description}</p>
          {children}
        </article>

        <aside className="panel integration-sidebar">
          <div className="panel-title-row">
            <h2>Install & Usage</h2>
            <span className="chip">copy-ready</span>
          </div>
          <div className="snippet-stack">
            {snippets.map((snippet) => (
              <CodeSnippet
                key={`${snippet.title}-${snippet.language ?? 'plain'}`}
                title={snippet.title}
                code={snippet.code}
                language={snippet.language}
              />
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
