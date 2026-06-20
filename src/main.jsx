/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import ReactDOM from 'react-dom/client'
import { reportError } from '@/lib/errorReporter'

/**
 * Live shell entrypoint
 *
 * V3 is the only production shell mounted by the app.
 * - `src/v3/*` is the active shell and chrome layer
 * - `src/new/*` contains shared pages, hooks, and UI building blocks consumed by V3
 *
 * If a future shell swap is intentional, change this import and update `src/SHELLS.md`.
 */

const root = ReactDOM.createRoot(document.getElementById('root'))

const StartupError = ({ title, detail }) => (
  <div
    style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)',
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
      padding: 24,
      boxSizing: 'border-box',
    }}
  >
    <div
      style={{
        width: 'min(760px, 100%)',
        background: 'rgba(255,255,255,0.98)',
        border: '1px solid #fecaca',
        borderRadius: 24,
        boxShadow: '0 24px 48px rgba(15,23,42,0.12)',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
        Startup Error
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, color: '#111827', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.7, marginBottom: 16 }}>
        The application failed before the main UI could mount.
      </div>
      <pre
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: '#f8fafc',
          border: '1px solid #e5e7eb',
          borderRadius: 16,
          padding: 16,
          color: '#1f2937',
          fontSize: 12.5,
          lineHeight: 1.6,
        }}
      >
        {detail}
      </pre>
    </div>
  </div>
)

window.addEventListener('error', (event) => {
  if (!event?.error) return
  reportError(event.error, { type: 'window.error' })
  root.render(
    <StartupError
      title="A runtime error occurred."
      detail={event.error?.stack || event.error?.message || String(event.error)}
    />,
  )
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason
  reportError(reason instanceof Error ? reason : new Error(String(reason)), {
    type: 'unhandledRejection',
    promise: String(event?.promise || ''),
  })
  root.render(
    <StartupError
      title="An unhandled promise rejection occurred."
      detail={reason?.stack || reason?.message || String(reason)}
    />,
  )
})

const appModulePromise = import('./v3/AppShellV3')

appModulePromise
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  })
  .catch((error) => {
    root.render(
      <StartupError
        title="The app module could not be loaded."
        detail={error?.stack || error?.message || String(error)}
      />,
    )
  })
