import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'

export type InviteFlow = 'supabase' | 'legacy'

type InviteOnboardingContextValue = {
  flow: InviteFlow | null
  legacyToken: string | null
  password: string
  setSupabaseFlow: () => void
  setLegacyFlow: (token: string) => void
  setPassword: (password: string) => void
  reset: () => void
}

const InviteOnboardingContext = createContext<InviteOnboardingContextValue | null>(null)

export function InviteOnboardingProvider({ children }: { children: React.ReactNode }) {
  const [flow, setFlow] = useState<InviteFlow | null>(null)
  const [legacyToken, setLegacyToken] = useState<string | null>(null)
  const [password, setPasswordState] = useState('')

  const setSupabaseFlow = useCallback(() => {
    setFlow('supabase')
    setLegacyToken(null)
    setPasswordState('')
  }, [])

  const setLegacyFlow = useCallback((token: string) => {
    setFlow('legacy')
    setLegacyToken(token)
    setPasswordState('')
  }, [])

  const setPassword = useCallback((value: string) => {
    setPasswordState(value)
  }, [])

  const reset = useCallback(() => {
    setFlow(null)
    setLegacyToken(null)
    setPasswordState('')
  }, [])

  const value = useMemo(
    () => ({
      flow,
      legacyToken,
      password,
      setSupabaseFlow,
      setLegacyFlow,
      setPassword,
      reset,
    }),
    [flow, legacyToken, password, setSupabaseFlow, setLegacyFlow, setPassword, reset],
  )

  return <InviteOnboardingContext.Provider value={value}>{children}</InviteOnboardingContext.Provider>
}

export function useInviteOnboarding(): InviteOnboardingContextValue {
  const ctx = useContext(InviteOnboardingContext)
  if (!ctx) throw new Error('useInviteOnboarding must be used within InviteOnboardingProvider')
  return ctx
}
