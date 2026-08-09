import { useQuery } from '@tanstack/react-query'
import { api } from './api-client.js'

/** Public instance settings — same queryKey everywhere so callers share one cached fetch. */
export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api.settings.get(),
  })
}
