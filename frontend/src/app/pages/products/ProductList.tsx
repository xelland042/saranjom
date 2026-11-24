// The products list: search (name, article, barcode or МХИК, in any script), a category filter,
// active or archived, 50 at a time, with its stock and a column per price list, sortable, and an
// Excel file. A row opens the product's page. Filters live in the address.
import { useState, type CSSProperties } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Archive, FileUp, FolderTree, Package, Plus, Search, SearchX, Tags } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ImportDialog from '../../ImportDialog'
import { ExportButton, SortHeader } from '../../ListTools'
import { formatDecimal, formatMoney } from '../../money'
import { EmptyState, PageHeader } from '../../Page'
import { usePrefs } from '../../prefs'
import { categoriesQuery, priceListsQuery, productList, useEquivalent } from '../../products'
import StatStrip from '../../StatStrip'
import { useOverview } from '../../useOverview'
import { useSearchBox } from '../../useSearchBox'
import { useStoredFlag } from '../../useStoredFlag'
import CategoriesDialog from './CategoriesDialog'
import PriceListsDialog from './PriceListsDialog'
import ProductForm from './ProductForm'
import { useCan } from '../../session'

const route = getRouteApi('/app/products')

const tile = (Icon: typeof Package, color: string) => (
  <span className="tile" style={{ '--c': color, '--t': '52px' } as CSSProperties} aria-hidden="true">
    <Icon className="size-6" />
  </span>
)
// price columns appear as the screen widens: the default list first
const PRICE_COLUMN = ['hidden md:table-cell', 'hidden xl:table-cell', 'hidden 2xl:table-cell']

export default function ProductList() {
  const { t, lang } = usePrefs()
  const can = useCan()
  const { q = '', category, archived = false, sort = 'name' } = route.useSearch()
  const navigate = route.useNavigate()
  const [text, onType] = useSearchBox(q, (v) => navigate({ search: (s) => ({ ...s, q: v }), replace: true }))
  const [adding, setAdding] = useState(false)
  const [dialog, setDialog] = useState<'lists' | 'categories' | 'import' | null>(null)
  const [showEquivalent, setShowEquivalent] = useStoredFlag('show-equivalent')
  const equivalent = useEquivalent()
  const { d } = useOverview()

  const list = useInfiniteQuery(productList(q, category, archived, sort))
  const head = (label: string, field: string, extra?: { className?: string; descFirst?: boolean; align?: 'left' | 'right' }) => (
    <SortHeader label={label} field={field} sort={sort} onSort={(s) => navigate({ search: (x) => ({ ...x, sort: s === 'name' ? undefined : s }), replace: true })} {...extra} />
  )
  const categories = useQuery(categoriesQuery)
  const lists = useQuery(priceListsQuery)
  const columns = (lists.data ?? []).filter((l) => !l.archived).slice(0, PRICE_COLUMN.length)
  const categoryName = new Map(categories.data?.map((c) => [c.id, c.name]))
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0

  const addButton = can('products.write') && (
    <Button onClick={() => setAdding(true)}>
      <Plus aria-hidden="true" /> {t('addProduct')}
    </Button>
  )

  let body
  if (list.isPending) {
    body = (
      <div className="grid gap-3 p-4" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 rounded-xl" />
        ))}
      </div>
    )
  } else if (list.isError) {
    body = (
      <div className="grid justify-items-center gap-3 px-6 py-14 text-center">
        <p>{t('offline')}</p>
        <Button variant="secondary" onClick={() => list.refetch()}>
          {t('retry')}
        </Button>
      </div>
    )
  } else if (rows.length === 0) {
    body =
      q || category ? (
        <EmptyState bare icon={tile(SearchX, 'var(--violet)')} title={t('nothingFound')} text={t('nothingFoundText')} />
      ) : archived ? (
        <EmptyState bare icon={tile(Archive, 'var(--violet)')} title={t('noArchived')} text={t('noArchivedText')} />
      ) : (
        <EmptyState bare icon={tile(Package, 'var(--violet)')} title={t('noProducts')} text={t('noProductsText')} action={addButton || undefined} />
      )
  } else {
    body = (
      <>
        <table className="w-full table-fixed text-sm" data-stale={list.isPlaceholderData || undefined}>
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-(--line)">
              {head(t('productName'), 'name')}
              {head(t('sku'), 'sku', { className: 'hidden w-36 sm:table-cell' })}
              {head(t('inStock'), 'stock', { className: 'w-32 text-right', descFirst: true, align: 'right' })}
              <th scope="col" className="hidden w-44 px-4 py-3 font-medium lg:table-cell">{t('category')}</th>
              {columns.map((l, i) => (
                <th key={l.id} scope="col" className={`${PRICE_COLUMN[i]} w-40 px-4 py-3 text-right font-medium`}>
                  <span className="block truncate">{l.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const price = new Map(p.prices.map((x) => [x.price_list_id, x.amount]))
              const main = columns[0] && price.get(columns[0].id)
              return (
                <tr key={p.id} className="relative border-b border-(--line) transition-colors last:border-0 hover:bg-(--soft)">
                  <td className="px-4 py-3">
                    {/* the button covers the whole row, so any part of it opens the product */}
                    <Link
                      to="/products/$productId"
                      params={{ productId: String(p.id) }}
                      className="block w-full truncate text-left font-medium after:absolute after:inset-0 focus-visible:outline-none after:focus-visible:rounded-lg after:focus-visible:outline-2 after:focus-visible:outline-(--accent)"
                    >
                      {p.name}
                    </Link>
                    {/* on phones the other columns are hidden: the article and main price under the name */}
                    <span className="block truncate text-xs text-muted-foreground md:hidden">
                      {[p.sku, main && formatMoney(main, columns[0].currency, lang)].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="hidden truncate px-4 py-3 text-muted-foreground sm:table-cell">{p.sku ?? '—'}</td>
                  <td className={`px-4 py-3 text-right whitespace-nowrap tabular-nums ${Number(p.stock) < 0 ? 'text-red' : p.low ? 'text-amber' : ''}`}>
                    {formatDecimal(p.stock)} <span className="text-xs text-muted-foreground">{t(`unit_${p.unit}`)}</span>
                    {p.low && <span className="block text-xs">{t('runningLow')}</span>}
                  </td>
                  <td className="hidden truncate px-4 py-3 text-muted-foreground lg:table-cell">
                    {(p.category_id && categoryName.get(p.category_id)) || '—'}
                  </td>
                  {columns.map((l, i) => {
                    const amount = price.get(l.id)
                    const hint = showEquivalent && amount && equivalent(amount, l.currency)
                    return (
                      <td key={l.id} className={`${PRICE_COLUMN[i]} px-4 py-3 text-right whitespace-nowrap tabular-nums`}>
                        {amount ? formatMoney(amount, l.currency, lang) : <span className="text-muted-foreground">—</span>}
                        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--line) px-4 py-3 text-xs text-muted-foreground">
          <span aria-live="polite">
            {t('shown')}: {rows.length} {t('of')} {total}
          </span>
          {list.hasNextPage && (
            <Button size="sm" variant="secondary" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
              {t('showMore')}
            </Button>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={t('products')}
        description={t('productsIntro')}
        actions={
          <>
            {can('products.write') && (
              <>
                <Button variant="outline" onClick={() => setDialog('lists')}>
                  <Tags aria-hidden="true" /> {t('priceLists')}
                </Button>
                <Button variant="outline" onClick={() => setDialog('categories')}>
                  <FolderTree aria-hidden="true" /> {t('categories')}
                </Button>
                <Button variant="outline" onClick={() => setDialog('import')}>
                  <FileUp aria-hidden="true" /> {t('importButton')}
                </Button>
              </>
            )}
            <ExportButton path="/products/export" params={{ q, category_id: category, archived, sort }} />
            {addButton}
          </>
        }
      />

      {!archived && d && (
        <StatStrip
          stats={[
            { label: t('products'), value: list.data?.pages[0]?.total ?? '…' },
            { label: t('showLow'), value: d?.stock.low ?? '…', tone: d?.stock.low ? 'amber' : undefined, link: { to: '/stock', search: { show: 'low' } } },
            { label: t('showNegative'), value: d?.stock.negative ?? '…', tone: d?.stock.negative ? 'red' : undefined, link: { to: '/stock', search: { show: 'negative' } } },
          ]}
        />
      )}
      <div className="rise mb-4 flex flex-wrap items-center gap-3" style={{ '--i': 1 } as CSSProperties}>
        <div className="relative min-w-0 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={text}
            onChange={(e) => onType(e.target.value)}
            placeholder={t('searchProductsShort')}
            aria-label={t('searchProducts')}
            className="pl-10"
          />
        </div>
        <Select
          value={category ? String(category) : 'all'}
          onValueChange={(v) => navigate({ search: (s) => ({ ...s, category: v === 'all' ? undefined : Number(v) }) })}
        >
          <SelectTrigger className="w-48" aria-label={t('category')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('allCategories')}</SelectItem>
            {categories.data?.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showEquivalent} onCheckedChange={setShowEquivalent} />
          {t('showEquivalent')}
        </label>
        <Tabs value={archived ? 'archived' : 'active'} onValueChange={(v) => navigate({ search: (s) => ({ ...s, archived: v === 'archived' ? true : undefined }) })}>
          <TabsList>
            <TabsTrigger value="active">{t('activeTab')}</TabsTrigger>
            <TabsTrigger value="archived">{t('archivedTab')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <section className="glass rise overflow-hidden" style={{ '--i': 2 } as CSSProperties} aria-label={t('products')}>
        {body}
      </section>

      <ProductForm open={adding} showEquivalent={showEquivalent} onOpenChange={setAdding} />
      <PriceListsDialog open={dialog === 'lists'} onOpenChange={(o) => !o && setDialog(null)} />
      <CategoriesDialog open={dialog === 'categories'} onOpenChange={(o) => !o && setDialog(null)} />
      <ImportDialog kind="products" open={dialog === 'import'} onOpenChange={(o) => !o && setDialog(null)} />
    </>
  )
}
