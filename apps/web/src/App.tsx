import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { Layout } from './components/Layout.js'
import { ProtectedRoute } from './components/ProtectedRoute.js'
import { SetupPage } from './routes/SetupPage.js'
import { LoginPage } from './routes/LoginPage.js'
import { RegisterPage } from './routes/RegisterPage.js'
import { SearchPage } from './routes/SearchPage.js'
import { HistoryPage } from './routes/HistoryPage.js'
import { ImportPage } from './routes/ImportPage.js'
import { SettingsPage } from './routes/SettingsPage.js'
import { NotFoundPage } from './routes/NotFoundPage.js'

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
          { path: '/', element: <Navigate to="/history" replace /> },
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
