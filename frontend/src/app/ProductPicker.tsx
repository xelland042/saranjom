// Pick a product by name, article or barcode; see Picker for the keys and the barcode scanner.
import { api } from './api'
import Picker from './Picker'
import { usePrefs } from './prefs'
import type { Product } from './products'

type Props = { value: Product | null; onChange: (p: Product) => void; id?: string; invalid?: boolean; autoFocus?: boolean }

const search = (q: string, limit: number) =>
  api<{ items: Product[] }>(`/products?${new URLSearchParams({ q, limit: String(limit) })}`).then((r) => r.items)

export default function ProductPicker(props: Props) {
  const { t } = usePrefs()
  return (
    <Picker
      {...props}
      search={search}
      queryKey="products"
      label={(p) => p.name}
      detail={(p) => p.sku}
      placeholder={t('chooseProduct')}
      noMatches={t('noMatches')}
    />
  )
}
