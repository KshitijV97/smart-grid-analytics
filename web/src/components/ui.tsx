import type { ReactNode } from 'react'

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`card bg-base-100 border-base-300 border ${className}`}>
      <div className="card-body gap-3 p-4 sm:p-5">
        {(title || actions) && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            {title && <h2 className="card-title text-base">{title}</h2>}
            {actions}
          </div>
        )}
        {children}
      </div>
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
}) {
  return (
    <div className="bg-base-100 border-base-300 rounded-box border p-4">
      <div className="text-base-content/70 text-xs font-medium tracking-wide uppercase">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-base-content/60 mt-1 text-xs">{hint}</div>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="text-base-content/70 flex items-center gap-2 p-4 text-sm">
      <span className="loading loading-spinner loading-sm" /> {label}
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div role="alert" className="alert alert-error alert-soft text-sm">
      <span>{msg}</span>
    </div>
  )
}

const STATUS_CLASS: Record<string, string> = {
  succeeded: 'badge-success',
  failed: 'badge-error',
  running: 'badge-info',
  queued: 'badge-ghost',
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-sm badge-soft ${STATUS_CLASS[status] ?? 'badge-ghost'}`}>
      {status === 'running' && <span className="loading loading-spinner loading-xs" />}
      {status}
    </span>
  )
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle && <p className="text-base-content/70 mt-1 text-sm">{subtitle}</p>}
    </header>
  )
}
