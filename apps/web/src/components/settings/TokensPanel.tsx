import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api-client.js'
import { Card } from '../ui/Card.js'
import { Field } from '../ui/Field.js'
import { Button } from '../ui/Button.js'
import { Spinner } from '../ui/Spinner.js'

export function TokensPanel() {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [justCreated, setJustCreated] = useState<string>()

  const { data, isLoading } = useQuery({
    queryKey: ['tokens'],
    queryFn: () => api.tokens.list(),
  })

  const createToken = useMutation({
    mutationFn: () => api.tokens.create({ name }),
    onSuccess: (created) => {
      setJustCreated(created.token)
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  const revokeToken = useMutation({
    mutationFn: (id: string) => api.tokens.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tokens'] }),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setJustCreated(undefined)
    createToken.mutate()
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold">{t('settings.tokens.title')}</h2>
      <div className="mb-4 mt-1 border-t border-[var(--color-border)]" />
      <p className="mb-4 text-sm text-[var(--color-fg-muted)]">
        {t('settings.tokens.description')}
      </p>

      {justCreated && (
        <div
          role="status"
          className="mb-4 rounded-md border border-[var(--color-primary)] bg-[var(--color-bg)] p-3"
        >
          <p className="mb-1 text-sm">{t('settings.tokens.createdOnce')}</p>
          <code className="block truncate text-sm">{justCreated}</code>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mb-6 flex items-end gap-2">
        <Field
          label={t('settings.tokens.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="flex-1"
        />
        <Button type="submit" isLoading={createToken.isPending}>
          {t('settings.tokens.create')}
        </Button>
      </form>

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <ul className="flex flex-col gap-2">
          {data?.tokens.map((token) => (
            <li
              key={token.id}
              className="flex items-center justify-between gap-4 rounded-md border border-[var(--color-border)] p-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{token.name}</p>
                <p className="text-sm text-[var(--color-fg-muted)]">
                  {token.lastUsedAt
                    ? t('settings.tokens.lastUsed', {
                        date: new Date(token.lastUsedAt).toLocaleString(i18n.language),
                      })
                    : t('settings.tokens.neverUsed')}
                </p>
              </div>
              <Button
                variant="danger"
                onClick={() => revokeToken.mutate(token.id)}
                aria-label={`${t('settings.tokens.revoke')}: ${token.name}`}
              >
                {t('settings.tokens.revoke')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
