// On a customer's or an order's page: the open tasks about it, and adding one.
import { useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Customer } from '../../customers'
import { usePrefs } from '../../prefs'
import { taskList, type Task } from '../../tasks'
import TaskDialog, { type TaskDraft } from './TaskDialog'
import TaskRows from './TaskRows'

type About = { customer: Pick<Customer, 'id' | 'name'>; order?: { id: number; number: number } }

export default function CustomerTasks({ customer: c, order }: About) {
  const { t } = usePrefs()
  const tasks = useQuery(taskList('open', order ? { order_id: order.id } : { customer_id: c.id })).data?.items ?? []
  const [dialog, setDialog] = useState<{ open: boolean; task?: Task; draft?: TaskDraft }>({ open: false })
  return (
    <section className="glass rise p-5" style={{ '--i': 4 } as CSSProperties} aria-labelledby="customer-tasks">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="customer-tasks" className="text-lg font-semibold">{t('tasks')}</h2>
        <Button size="sm" variant="secondary" onClick={() => setDialog({ open: true, draft: { customer_id: c.id, customer_name: c.name, order_id: order?.id ?? null } })}>
          <Plus aria-hidden="true" /> {t('newTask')}
        </Button>
      </div>
      {tasks.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t(order ? 'noOrderTasks' : 'noCustomerTasks')}</p>
      ) : (
        <TaskRows tasks={tasks} showCustomer={false} onOpen={(task) => setDialog({ open: true, task })} />
      )}
      <TaskDialog open={dialog.open} task={dialog.task} draft={dialog.draft} onOpenChange={(open) => setDialog({ ...dialog, open })} />
    </section>
  )
}
