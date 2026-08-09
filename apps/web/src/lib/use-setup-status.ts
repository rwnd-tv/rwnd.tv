import { useQuery } from '@tanstack/react-query'
import { api } from './api-client.js'

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup', 'status'],
    queryFn: () => api.setup.status(),
  })
}
