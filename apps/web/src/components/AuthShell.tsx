import React from 'react'
import { Icon } from './Icon'

type AuthShellProps = {
  children: React.ReactNode
  showBrand?: boolean
}

export function AuthShell({ children, showBrand = true }: AuthShellProps) {
  return (
    <div className="bg-technical-pattern relative flex min-h-screen items-center justify-center">
      <div className="blueprint-grid pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="fixed top-0 left-0 z-0 h-1 w-full bg-primary" aria-hidden />
      <main className="relative z-10 w-full max-w-[440px] px-6 py-12">
        {showBrand ? (
          <div className="mb-10 flex flex-col items-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-on-primary shadow-lg">
              <Icon name="architecture" className="text-[32px]" />
            </div>
            <h1 className="text-headline-md text-primary tracking-tight">Cambre Planos</h1>
            <p className="text-technical-label mt-1 text-outline uppercase">Portal técnico de luminarias</p>
          </div>
        ) : null}
        {children}
        <footer className="mt-12 space-y-2 text-center">
          <p className="text-technical-label text-outline">MVP · VanguardIA</p>
        </footer>
      </main>
    </div>
  )
}
