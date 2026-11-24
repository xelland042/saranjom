// Showcase of the shadcn components in the current look, with Uzbek and Russian labels to test lengths.
// Open it at /#/components (or /#light/components and so on). Not a real screen.
import { useState, type ReactNode } from 'react'
import { MoreHorizontal, Pencil, Plus, Trash2, Archive } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Look } from './looks'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass flex flex-col gap-4 p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

// Status badges: color plus a word, never color alone.
const STATUS = {
  paid: 'border-transparent bg-green/15 text-green',
  overdue: 'border-transparent bg-red/15 text-red',
  draft: 'border-transparent bg-amber/15 text-amber',
}

export default function Kit({ look }: { look: Look }) {
  const [loading, setLoading] = useState(true)
  const dark = look === 'glass' || look === 'plain-dark'

  return (
    <TooltipProvider>
      <header className="page-head rise">
        <div>
          <h1>Components</h1>
          <p>shadcn/ui in this look. Switch looks in the sidebar to compare.</p>
        </div>
      </header>

      <div className="grid gap-5 pb-10 [grid-template-columns:repeat(auto-fill,minmax(min(100%,380px),1fr))]">
        <Card title="Buttons">
          <div className="flex flex-wrap gap-2">
            <Button><Plus /> Yangi mijoz</Button>
            <Button variant="secondary">Сохранить черновик</Button>
            <Button variant="outline">Bekor qilish</Button>
            <Button variant="ghost">Подробнее</Button>
            <Button variant="destructive"><Trash2 /> Удалить</Button>
            <Button variant="link">Barchasini koʻrish</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm">Kichik</Button>
            <Button size="lg">Большая кнопка</Button>
            <Button disabled>Oʻchirilgan</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" variant="outline" aria-label="Tahrirlash"><Pencil /></Button>
              </TooltipTrigger>
              <TooltipContent>Tahrirlash · Редактировать</TooltipContent>
            </Tooltip>
          </div>
        </Card>

        <Card title="Contact form">
          <div className="grid gap-2">
            <Label htmlFor="kit-name">Kompaniya nomi</Label>
            <Input id="kit-name" placeholder="«Gʻalla Savdo» MChJ" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kit-inn">ИНН</Label>
            <Input id="kit-inn" defaultValue="30512" aria-invalid aria-describedby="kit-inn-err" />
            <p id="kit-inn-err" className="text-sm text-red">ИНН должен содержать 9 цифр</p>
          </div>
          <div className="grid gap-2">
            <Label>Viloyat · Регион</Label>
            <Select defaultValue="tashkent">
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="tashkent">Toshkent shahri</SelectItem>
                <SelectItem value="samarkand">Samarqand viloyati</SelectItem>
                <SelectItem value="fergana">Фарғона вилояти</SelectItem>
                <SelectItem value="karakalpak">Qoraqalpogʻiston Respublikasi</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kit-note">Izoh</Label>
            <Textarea id="kit-note" placeholder="Комментарий к клиенту…" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="kit-vat" defaultChecked />
            <Label htmlFor="kit-vat">QQS toʻlovchisi · Плательщик НДС</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="kit-active" defaultChecked />
            <Label htmlFor="kit-active">Faol mijoz</Label>
          </div>
        </Card>

        <Card title="Overlays">
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild><Button variant="outline">Dialog</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Mijozni arxivlash?</DialogTitle>
                  <DialogDescription>
                    «Gʻalla Savdo» roʻyxatdan yashiriladi. Buyurtmalar va qarzlar saqlanadi.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild><Button variant="outline">Bekor qilish</Button></DialogClose>
                  <DialogClose asChild><Button onClick={() => toast.success('Mijoz arxivlandi')}>Arxivlash</Button></DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Amallar"><MoreHorizontal /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>Действия</DropdownMenuLabel>
                <DropdownMenuItem><Pencil /> Tahrirlash</DropdownMenuItem>
                <DropdownMenuItem><Archive /> Архивировать</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive"><Trash2 /> Oʻchirish</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover>
              <PopoverTrigger asChild><Button variant="outline">Filtr</Button></PopoverTrigger>
              <PopoverContent className="grid gap-3">
                <p className="text-sm font-medium">Holat · Статус</p>
                {['Toʻlangan', 'Просрочен', 'Qoralama'].map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <Checkbox id={`kit-f-${s}`} />
                    <Label htmlFor={`kit-f-${s}`}>{s}</Label>
                  </div>
                ))}
              </PopoverContent>
            </Popover>

            <Button variant="secondary" onClick={() => toast('Сохранено', { description: 'Изменения сохранены в 14:32' })}>
              Toast
            </Button>
            <Button variant="secondary" onClick={() => toast.error('Hisob-faktura yuborilmadi', { description: 'Didox javob bermadi. Qayta urinib koʻring.' })}>
              Error toast
            </Button>
          </div>
        </Card>

        <Card title="Tabs and statuses">
          <Tabs defaultValue="info">
            <TabsList>
              <TabsTrigger value="info">Maʼlumot</TabsTrigger>
              <TabsTrigger value="orders">Заказы</TabsTrigger>
              <TabsTrigger value="debts">Qarzlar</TabsTrigger>
            </TabsList>
            <TabsContent value="info" className="pt-2 text-sm text-muted-foreground">
              Toshkent, Chilonzor tumani. Mas'ul: Rustam Saidov.
            </TabsContent>
            <TabsContent value="orders" className="pt-2 text-sm text-muted-foreground">12 заказов за месяц.</TabsContent>
            <TabsContent value="debts" className="pt-2 text-sm text-muted-foreground">1 390 000 soʻm, 2 ta muddati oʻtgan.</TabsContent>
          </Tabs>
          <div className="flex flex-wrap gap-2">
            <Badge className={STATUS.paid}>Toʻlangan</Badge>
            <Badge className={STATUS.overdue}>Просрочен</Badge>
            <Badge className={STATUS.draft}>Qoralama</Badge>
            <Badge>Yangi</Badge>
            <Badge variant="secondary">Оптовый</Badge>
            <Badge variant="outline">VIP</Badge>
          </div>
        </Card>

        <Card title="Loading">
          <div className="flex items-center gap-4">
            {loading ? <Skeleton className="size-12 rounded-full" /> : <div className="grid size-12 place-items-center rounded-full bg-primary text-primary-foreground font-semibold">RS</div>}
            <div className="grid flex-1 gap-2">
              {loading ? (
                <>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Rustam Saidov</p>
                  <p className="text-sm text-muted-foreground">Savdo agenti · Торговый агент</p>
                </>
              )}
            </div>
          </div>
          <Button variant="outline" className="self-start" onClick={() => setLoading((l) => !l)}>
            {loading ? 'Yuklashni tugatish' : 'Показать загрузку'}
          </Button>
        </Card>
      </div>

      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-right" />
    </TooltipProvider>
  )
}
