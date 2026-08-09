import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api-client.js'
import { useDebouncedValue } from '../lib/use-debounced-value.js'
import { SearchResultCard } from '../components/SearchResultCard.js'
import { Field } from '../components/ui/Field.js'
import { Spinner } from '../components/ui/Spinner.js'

export function SearchPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 350)

  const { data, isFetching, isError } = useQuery({
    queryKey: ['search', debouncedQuery],
    queryFn: () => api.search(debouncedQuery),
    enabled: debouncedQuery.trim().length > 0,
  })

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('search.title')}</h1>
      <Field
        label={t('search.placeholder')}
        hideLabel
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {isFetching && <Spinner label={t('common.loading')} />}
      {isError && (
        <p role="alert" className="text-[var(--color-danger)]">
          {t('common.somethingWentWrong')}
        </p>
      )}
      {!isFetching && !isError && debouncedQuery && data?.results.length === 0 && (
        <p className="text-[var(--color-fg-muted)]">{t('search.noResults')}</p>
      )}
      <ul className="flex flex-col gap-3">
        {data?.results.map((result) => (
          <SearchResultCard key={`${result.type}-${result.externalId}`} result={result} />
        ))}
      </ul>
    </div>
  )
}
