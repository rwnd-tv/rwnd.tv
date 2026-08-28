import { createContext, useContext } from 'react'
import type { User } from '@rwnd/shared'

export interface AuthContextValue {
  user: User | null
  isLoading: boolean
  refetch: () => Promise<unknown>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
