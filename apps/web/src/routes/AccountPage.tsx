import { useTranslation } from 'react-i18next'
import { EmailCard } from '../components/account/EmailCard.js'
import { ChangePasswordCard } from '../components/account/ChangePasswordCard.js'
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
 * Profile, Preferences, and Advanced Preferences are the actual named
 * sections. See ProfileCard.tsx's doc comment for why Profile/
 * Preferences/Advanced Preferences each save independently rather than
 * sharing one cross-card form. Log out started as its own section at the
 * bottom, then moved the same day to sit inline with the page title —
 * James wanted it reachable without scrolling past everything else.
 * Delete account is deliberately last — the most destructive action on
 * the page belongs at the end, not competing for attention with
 * everything above it.
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
      <PreferencesCard />
      <AdvancedPreferencesCard />
      <DeleteAccountCard />
    </div>
  )
}
