import React from 'react'
import { useAuth } from '../context/AuthContext'
import { getAppRole } from '../lib/roles'
import { Icon } from './Icon'

export type AppNavId = 'dashboard' | 'jobs' | 'invites' | 'normative-rules' | 'settings'

type AppShellProps = {
  children: React.ReactNode
  activeNav: AppNavId
  onNavigate: (path: string) => void
  headerTitle?: string
  showExport?: boolean
  onExportClick?: () => void
}

export function AppShell({
  children,
  activeNav,
  onNavigate,
  headerTitle = 'Portal de gestión de proyectos',
  showExport = false,
  onExportClick,
}: AppShellProps) {
  const { session, signOut } = useAuth()
  const role = getAppRole(session?.user)
  const email = session?.user.email ?? 'Usuario'

  async function handleLogout() {
    await signOut()
    onNavigate('/login')
  }

  const navItems: { id: AppNavId; label: string; icon: string; path: string }[] = [
    { id: 'dashboard', label: 'Proyectos', icon: 'account_tree', path: '/dashboard' },
  ]
  if (role === 'architect' || role === 'administrator') {
    navItems.push({
      id: 'normative-rules',
      label: 'Reglas normativas',
      icon: 'rule',
      path: '/normative-rules',
    })
  }
  if (role === 'administrator') {
    navItems.push({ id: 'invites', label: 'Invitaciones', icon: 'mail', path: '/invites' })
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed top-0 left-0 z-50 flex h-screen w-[260px] flex-col border-r border-outline-variant bg-surface-container-lowest px-4 py-8">
        <div className="mb-10 px-2">
          <h1 className="text-headline-md font-bold text-primary">Cambre Planos</h1>
          <p className="text-technical-label mt-1 tracking-wider text-on-surface-variant uppercase">
            División técnica
          </p>
        </div>

        <nav className="flex-1 space-y-1" aria-label="Principal">
          {navItems.map((item) => {
            const active = activeNav === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.path)}
                className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-all active:scale-[0.98] ${
                  active
                    ? 'bg-primary-container font-bold text-on-primary-container'
                    : 'text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                <Icon name={item.icon} className={active ? '' : 'text-outline'} />
                <span className="text-body-sm">{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="mt-auto border-t border-outline-variant pt-6">
          <div className="mb-4 flex items-center gap-3 px-2">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant bg-primary-container text-on-primary-container"
              aria-hidden
            >
              <Icon name="person" className="text-lg" />
            </div>
            <div className="min-w-0 overflow-hidden">
              <p className="truncate text-body-sm font-bold text-on-surface">{email}</p>
              <p className="text-technical-label truncate text-on-surface-variant">
                {role ?? 'sin rol'}
              </p>
            </div>
          </div>

          {role === 'architect' ? (
            <button
              type="button"
              className="btn-primary mb-4 w-full py-3 uppercase"
              onClick={() => onNavigate('/jobs/new')}
            >
              <Icon name="add" className="text-sm" />
              Nuevo proyecto
            </button>
          ) : null}

          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-4 py-2 text-body-sm text-brand-red transition-colors hover:bg-error-container/20"
            onClick={() => void handleLogout()}
          >
            <Icon name="logout" />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <header className="fixed top-0 right-0 left-[260px] z-40 flex h-16 items-center justify-between border-b border-outline-variant bg-surface-container-lowest px-8">
        <h2 className="text-headline-md font-bold text-primary">{headerTitle}</h2>
        <div className="flex items-center gap-4">
          {showExport ? (
            <button
              type="button"
              className="rounded-lg bg-secondary-container px-4 py-2 text-button font-semibold text-on-secondary-container transition-all hover:brightness-95"
              onClick={onExportClick}
            >
              Descargar DXF
            </button>
          ) : null}
        </div>
      </header>

      <main className="ml-[260px] min-h-screen pt-24 pb-12 px-8">
        <div className="mx-auto max-w-[var(--spacing-container-max)]">{children}</div>
      </main>
    </div>
  )
}
