import { useCallback, useEffect, useRef, useState } from 'react';

interface CodeSnippetProps {
  title: string;
  code: string;
  language?: string;
}

function fallbackCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}

export function CodeSnippet({ title, code, language }: CodeSnippetProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== undefined) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (resetTimerRef.current !== undefined) {
      window.clearTimeout(resetTimerRef.current);
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else if (!fallbackCopy(code)) {
        throw new Error('Clipboard unavailable');
      }
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    } finally {
      resetTimerRef.current = window.setTimeout(() => {
        setCopyState('idle');
        resetTimerRef.current = undefined;
      }, 1400);
    }
  }, [code]);

  return (
    <section className="snippet-card">
      <header className="snippet-header">
        <div>
          <h3>{title}</h3>
          {language ? <span>{language}</span> : null}
        </div>
        <button type="button" className="btn btn-soft" onClick={() => void handleCopy()}>
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </header>
      <pre className="snippet-pre">
        <code>{code}</code>
      </pre>
    </section>
  );
}
