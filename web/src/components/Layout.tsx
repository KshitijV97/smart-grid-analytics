import { Link, Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import { getAdminToken, setAdminToken } from '../lib/api'

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/data', label: 'Data' },
  { to: '/train', label: 'Train' },
  { to: '/models', label: 'Models' },
  { to: '/forecast', label: 'Forecast' },
] as const

export function Layout() {
  const [token, setToken] = useState(getAdminToken())
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-base-200 min-h-screen">
      <nav className="navbar bg-base-100 border-base-300 sticky top-0 z-10 border-b px-4">
        <div className="flex-1 gap-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <img src="/favicon.svg" alt="" className="h-5 w-5" />
            <span className="hidden sm:inline">Ottawa Load Forecasting</span>
          </Link>
          <ul className="menu menu-horizontal gap-1 p-0 text-sm">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link
                  to={n.to}
                  activeOptions={{ exact: n.to === '/' }}
                  activeProps={{ className: 'menu-active' }}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
          {token ? 'Admin ✓' : 'Admin token'}
        </button>
      </nav>
      <main className="mx-auto max-w-7xl p-4 sm:p-6">
        <Outlet />
      </main>
      <dialog className={`modal ${open ? 'modal-open' : ''}`}>
        <div className="modal-box">
          <h3 className="text-lg font-semibold">Admin token</h3>
          <p className="text-base-content/70 py-2 text-sm">
            Training, ingestion and deleting models need the token configured on the API (
            <code>ADMIN_TOKEN</code>). Locally it is empty, so leave this blank. It is kept in this
            browser only.
          </p>
          <input
            type="password"
            className="input w-full"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="paste token"
          />
          <div className="modal-action">
            <button
              className="btn btn-primary"
              onClick={() => {
                setAdminToken(token)
                setOpen(false)
              }}
            >
              Save
            </button>
          </div>
        </div>
        <button className="modal-backdrop" onClick={() => setOpen(false)}>
          close
        </button>
      </dialog>
    </div>
  )
}
