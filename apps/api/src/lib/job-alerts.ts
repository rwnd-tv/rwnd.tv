import { eq } from 'drizzle-orm'
import { instanceSettings, type Database } from '@rwnd/db'
import { isEmailConfigured, sendJobFailureAlert } from './email.js'

/**
 * Best-effort email alert for a scheduled background job (the daily
 * database backup, the metadata refresh sweep) that failed unattended —
 * the whole point being that a self-hoster who isn't actively watching the
 * admin panel still finds out. No-ops silently when there's nowhere to
 * send it (no SMTP configured, or no admin contact address set — the same
 * two preconditions every other email in this app already needs), and
 * never lets a failure to *send the alert* propagate: that would turn a
 * notification about a broken job into a second, unrelated crash.
 *
 * Deliberately its own module rather than living in lib/email.ts: that
 * file is otherwise a stateless set of templates with no `db` dependency
 * at all, and this needs one (to read instanceName/adminEmail) — kept out
 * to avoid giving every other sender in that file a reason to need one too.
 */
export async function alertOnJobFailure(
  db: Database,
  jobName: string,
  message: string,
): Promise<void> {
  if (!isEmailConfigured()) return

  const [settings] = await db
    .select({
      instanceName: instanceSettings.instanceName,
      adminEmail: instanceSettings.adminEmail,
    })
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1))
  if (!settings?.adminEmail) return

  try {
    await sendJobFailureAlert(settings.adminEmail, settings.instanceName, jobName, message)
  } catch (err) {
    console.error(`Failed to send failure alert email for ${jobName}:`, err)
  }
}
