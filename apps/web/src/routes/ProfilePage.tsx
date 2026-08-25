import { useTranslation } from 'react-i18next'
import { ProfileForm } from '../components/profile/ProfileForm.js'
import { LogoutCard } from '../components/profile/LogoutCard.js'

export function ProfilePage() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('profile.title')}</h1>
      <ProfileForm />
      <LogoutCard />
    </div>
  )
}
