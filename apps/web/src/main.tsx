import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './i18n/index.js'
import './index.css'
import { App } from './App.js'
import { AuthProvider } from './lib/auth-context.js'
import { queryClient } from './lib/query-client.js'
import { PreferencesEffect } from './components/PreferencesEffect.js'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PreferencesEffect />
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
)
