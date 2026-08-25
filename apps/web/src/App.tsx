import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'
import { Layout } from './components/Layout.js'
import { ProtectedRoute } from './components/ProtectedRoute.js'
import type { RouteHandle } from './lib/route-handle.js'
import { SetupPage } from './routes/SetupPage.js'
import { LoginPage } from './routes/LoginPage.js'
import { RegisterPage } from './routes/RegisterPage.js'
import { ForgotPasswordPage } from './routes/ForgotPasswordPage.js'
import { ResetPasswordPage } from './routes/ResetPasswordPage.js'
import { VerifyEmailPage } from './routes/VerifyEmailPage.js'
import { ConfirmEmailChangePage } from './routes/ConfirmEmailChangePage.js'
import { DashboardPage } from './routes/DashboardPage.js'
import { HistoryPage } from './routes/HistoryPage.js'
import { ShowsPage } from './routes/ShowsPage.js'
import { ShowDetailPage } from './routes/ShowDetailPage.js'
import { SeasonDetailPage } from './routes/SeasonDetailPage.js'
import { EpisodeDetailPage } from './routes/EpisodeDetailPage.js'
import { MoviesPage } from './routes/MoviesPage.js'
import { MovieDetailPage } from './routes/MovieDetailPage.js'
import { ImportPage } from './routes/ImportPage.js'
import { SettingsPage } from './routes/SettingsPage.js'
import { AccountPage } from './routes/AccountPage.js'
import { NotFoundPage } from './routes/NotFoundPage.js'

// Gallery pages render full-viewport-width (see Layout.tsx) rather than the
// 896px reading column every other page uses — a poster grid wants the
// screen, prose doesn't.
const fullWidthHandle: RouteHandle = { width: 'full' }

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/verify-email', element: <VerifyEmailPage /> },
  { path: '/confirm-email-change', element: <ConfirmEmailChangePage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          // Dashboard is the app's default landing page — every post-auth
          // redirect (LoginPage, RegisterPage, SetupPage) independently
          // hardcodes '/dashboard' too.
          { path: '/', element: <Navigate to="/dashboard" replace /> },
          { path: '/dashboard', element: <DashboardPage />, handle: fullWidthHandle },
          { path: '/shows', element: <ShowsPage />, handle: fullWidthHandle },
          { path: '/shows/:slug', element: <ShowDetailPage />, handle: fullWidthHandle },
          {
            path: '/shows/:slug/season/:seasonNumber',
            element: <SeasonDetailPage />,
            handle: fullWidthHandle,
          },
          {
            path: '/shows/:slug/season/:seasonNumber/episode/:episodeNumber',
            element: <EpisodeDetailPage />,
            handle: fullWidthHandle,
          },
          { path: '/movies', element: <MoviesPage />, handle: fullWidthHandle },
          { path: '/movies/:slug', element: <MovieDetailPage />, handle: fullWidthHandle },
          { path: '/history', element: <HistoryPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { path: '/account', element: <AccountPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
])

export function App() {
  return <RouterProvider router={router} />
}
