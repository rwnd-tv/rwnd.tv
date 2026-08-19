import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { Layout } from './components/Layout.js'
import { ProtectedRoute } from './components/ProtectedRoute.js'
import type { RouteHandle } from './lib/route-handle.js'
import { SetupPage } from './routes/SetupPage.js'
import { LoginPage } from './routes/LoginPage.js'
import { RegisterPage } from './routes/RegisterPage.js'
import { SearchPage } from './routes/SearchPage.js'
import { HistoryPage } from './routes/HistoryPage.js'
import { ShowsPage } from './routes/ShowsPage.js'
import { MoviesPage } from './routes/MoviesPage.js'
import { ImportPage } from './routes/ImportPage.js'
import { SettingsPage } from './routes/SettingsPage.js'
import { NotFoundPage } from './routes/NotFoundPage.js'

// Gallery pages render full-viewport-width (see Layout.tsx) rather than the
// 896px reading column every other page uses — a poster grid wants the
// screen, prose doesn't.
const fullWidthHandle: RouteHandle = { width: 'full' }

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          // Deliberately still History, not Shows/Movies — every post-auth
          // redirect (LoginPage, RegisterPage, SetupPage) independently
          // hardcodes '/history' too, and changing the app's default
          // landing page is a real UX decision beyond this feature's scope.
          { path: '/', element: <Navigate to="/history" replace /> },
          { path: '/shows', element: <ShowsPage />, handle: fullWidthHandle },
          { path: '/movies', element: <MoviesPage />, handle: fullWidthHandle },
          { path: '/search', element: <SearchPage /> },
          { path: '/history', element: <HistoryPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/settings', element: <SettingsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])

export function App() {
  return <RouterProvider router={router} />
}
