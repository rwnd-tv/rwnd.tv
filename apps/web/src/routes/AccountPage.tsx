import { useTranslation } from 'react-i18next'
import { EmailCard } from '../components/account/EmailCard.js'
import { ChangePasswordCard } from '../components/account/ChangePasswordCard.js'
import { SessionsCard } from '../components/account/SessionsCard.js'
import { MfaCard } from '../components/account/MfaCard.js'
import { ProfileCard } from '../components/account/ProfileCard.js'
import { PreferencesCard } from '../components/account/PreferencesCard.js'
import { AdvancedPreferencesCard } from '../components/account/AdvancedPreferencesCard.js'
import { DeleteAccountCard } from '../components/account/DeleteAccountCard.js'
import { LogoutButton } from '../components/account/LogoutButton.js'

/**
 * Renamed from Profile → Account the same day it shipped (James,
 * 2026-08-25), once Change Password made it clear this page covers more
 * than just the "Profile" identity bits (photo/display name). Profile
 * leads the page — James, same day, moved it above Email/Change Password
 * after first seeing it lower down. Email and Change Password have no
 * section heading of their own — "Account" already says what they are;
 * Profile, Sessions, Two-factor authentication, Preferences, and Advanced
 * preferences are the actual named sections. MFA sits right after Change
 * Password — both are account-security actions from the same 2026-08-29
 * security review — rather than lower down with Preferences. Sessions
 * originally sat there too, then moved 2026-09-02 (James) to below
 * Advanced preferences: unlike the security-review cluster it's a
 * read-mostly status list, closer in spirit to the preferences/settings
 * views above it than to a security action you'd take. Linked accounts /
 * link a webhook account (the view and redeem halves of the link-code
 * consent rework, `docs/adr/0007-security-posture.md`'s addendum)
 * briefly lived here too (2026-09-02), then moved the same day to
 * Settings, directly below TokensPanel — James decided both belong with
 * the rest of the webhook/token machinery rather than on Account, and
 * later the same day merged into one `LinkedAccountsPanel.tsx`
 * (`components/settings/`) rather than two separate panels. See
 * ProfileCard.tsx's doc comment for why
 * Profile/Preferences/Advanced preferences each save independently
 * rather than sharing one cross-card form. Log out started as its own
 * section at the bottom, then moved the same day to sit inline with the
 * page title — James wanted it reachable without scrolling past
 * everything else. Delete account is deliberately last — the most
 * destructive action on the page belongs at the end, not competing for
 * attention with everything above it.
 */
export function AccountPage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('account.title')}</h1>
        <LogoutButton />
      </div>
      <ProfileCard />
      <EmailCard />
      <ChangePasswordCard />
      <MfaCard />
      <PreferencesCard />
      <AdvancedPreferencesCard />
      <SessionsCard />
      <DeleteAccountCard />
    </div>
  )
}
