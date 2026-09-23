import { beforeEach, describe, expect, it, vi } from 'vitest'
import { instanceSettings } from '@rwnd/db'
import { resetDb, testDb } from '../test/helpers.js'
import { alertOnJobFailure } from './job-alerts.js'

vi.mock('./email.js', () => ({
  isEmailConfigured: vi.fn(),
  sendJobFailureAlert: vi.fn(),
}))

const db = testDb()

describe('alertOnJobFailure', () => {
  beforeEach(async () => {
    await resetDb(db)
    vi.clearAllMocks()
  })

  it('does nothing when email is not configured, without even reading instance_settings', async () => {
    const email = await import('./email.js')
    vi.mocked(email.isEmailConfigured).mockReturnValue(false)

    await alertOnJobFailure(db, 'Database backup', 'disk full')

    expect(email.sendJobFailureAlert).not.toHaveBeenCalled()
  })

  it('does nothing when email is configured but no adminEmail is set', async () => {
    const email = await import('./email.js')
    vi.mocked(email.isEmailConfigured).mockReturnValue(true)
    await db.insert(instanceSettings).values({ id: 1, instanceName: 'rwnd.tv', adminEmail: null })

    await alertOnJobFailure(db, 'Database backup', 'disk full')

    expect(email.sendJobFailureAlert).not.toHaveBeenCalled()
  })

  it('sends to adminEmail with the instance name, job name, and message when both are set', async () => {
    const email = await import('./email.js')
    vi.mocked(email.isEmailConfigured).mockReturnValue(true)
    vi.mocked(email.sendJobFailureAlert).mockResolvedValue(undefined)
    await db
      .insert(instanceSettings)
      .values({ id: 1, instanceName: 'dev.rwnd.tv', adminEmail: 'admin@rwnd.tv' })

    await alertOnJobFailure(db, 'Database backup', 'pg_dump exited 1: disk full')

    expect(email.sendJobFailureAlert).toHaveBeenCalledWith(
      'admin@rwnd.tv',
      'dev.rwnd.tv',
      'Database backup',
      'pg_dump exited 1: disk full',
    )
  })

  it('catches a send failure rather than letting it propagate to the caller', async () => {
    const email = await import('./email.js')
    vi.mocked(email.isEmailConfigured).mockReturnValue(true)
    vi.mocked(email.sendJobFailureAlert).mockRejectedValue(new Error('SMTP connection refused'))
    await db
      .insert(instanceSettings)
      .values({ id: 1, instanceName: 'rwnd.tv', adminEmail: 'admin@rwnd.tv' })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(alertOnJobFailure(db, 'Metadata refresh', 'boom')).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
