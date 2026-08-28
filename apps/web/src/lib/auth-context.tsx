import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api-client.js'
import { AuthContext } from './use-auth.js'

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      try {
        return await api.auth.me()
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
  })

  return (
    <AuthContext.Provider value={{ user: data ?? null, isLoading, refetch }}>
      {children}
    </AuthContext.Provider>
  )
}
