// Fake data for the glass prototype: a small wholesale company in Tashkent.

export type Range = 'week' | 'month' | 'year'

export const salesByRange: Record<Range, { label: string; value: number }[]> = {
  week: [
    { label: 'Mon', value: 182 },
    { label: 'Tue', value: 241 },
    { label: 'Wed', value: 205 },
    { label: 'Thu', value: 318 },
    { label: 'Fri', value: 263 },
    { label: 'Sat', value: 124 },
    { label: 'Sun', value: 58 },
  ],
  month: [
    { label: 'Week 1', value: 1040 },
    { label: 'Week 2', value: 1215 },
    { label: 'Week 3', value: 980 },
    { label: 'Week 4', value: 1391 },
  ],
  year: [
    { label: 'Jan', value: 3.1 },
    { label: 'Feb', value: 3.4 },
    { label: 'Mar', value: 3.9 },
    { label: 'Apr', value: 3.6 },
    { label: 'May', value: 4.2 },
    { label: 'Jun', value: 3.8 },
    { label: 'Jul', value: 4.1 },
    { label: 'Aug', value: 4.0 },
    { label: 'Sep', value: 4.6 },
    { label: 'Oct', value: 4.9 },
    { label: 'Nov', value: 5.2 },
    { label: 'Dec', value: 2.1 },
  ],
}
// Units differ per range, so the chart labels values with these.
export const rangeUnit: Record<Range, string> = { week: 'M soʻm', month: 'M soʻm', year: 'B soʻm' }
export const rangeChange: Record<Range, number> = { week: 8.2, month: 5.4, year: 21.7 }

export const kpis = [
  { id: 'sales', icon: 'cash', label: 'Sales this week', value: '1.39B soʻm', change: 8.2, tone: 'blue', spark: [5, 7, 6, 9, 8, 11, 13] },
  { id: 'orders', icon: 'box', label: 'Orders', value: '86', change: 4.1, tone: 'green', spark: [6, 5, 8, 7, 9, 8, 11] },
  { id: 'deliveries', icon: 'truck', label: 'Deliveries', value: '64', change: -3.5, tone: 'amber', spark: [9, 11, 8, 10, 7, 9, 6] },
  { id: 'paid', icon: 'check', label: 'Paid on time', value: '86%', change: 2.3, tone: 'violet', spark: [6, 7, 7, 8, 7, 9, 10] },
] as const

export const today = [
  { time: '09:00', title: 'Morning delivery run', meta: '09:00 – 11:30 · 6 stops', tone: 'blue', people: ['AK', 'JT'] },
  { time: '11:00', title: 'Call Baraka Savdo about the overdue invoice', meta: '11:00 – 11:15', tone: 'amber', people: ['DS'] },
  { time: '14:00', title: 'Stock count, aisle B', meta: '14:00 – 16:00', tone: 'red', people: ['MR', 'AK'] },
  { time: '16:30', title: 'Price list review with Jasur', meta: '16:30 – 17:00', tone: 'violet', people: ['JT'] },
] as const

export const activity = [
  { who: 'Dilnoza', what: 'confirmed order', target: 'SO-1042', when: '2 min ago' },
  { who: 'Jasur', what: 'received a payment from', target: 'Oila Market', when: '18 min ago' },
  { who: 'Malika', what: 'marked as low stock', target: 'Sunflower oil 5 L', when: '1 h ago' },
  { who: 'Aziz', what: 'delivered', target: 'SO-1039', when: '2 h ago' },
]

export const team = [
  { name: 'Dilnoza Saidova', role: 'Sales manager', online: true },
  { name: 'Jasur Tursunov', role: 'Accountant', online: true },
  { name: 'Aziz Karimov', role: 'Driver', online: false },
]

export const goal = { label: 'November sales target', done: 82 }

export type Chat = { id: string; name: string; company: string; last: string; when: string; unread: number; online: boolean }
export const chats: Chat[] = [
  { id: 'baraka', name: 'Sardor Aliev', company: 'Baraka Savdo', last: 'Can you deliver on Saturday?', when: '10:42', unread: 2, online: true },
  { id: 'oila', name: 'Nodira Yusupova', company: 'Oila Market', last: 'Payment sent, please check', when: '10:15', unread: 1, online: true },
  { id: 'korzinka', name: 'Bekzod Rakhimov', company: 'Korzinka Chilonzor', last: 'We need 40 more boxes of tea', when: 'Yesterday', unread: 0, online: false },
  { id: 'navroz', name: 'Gulnora Ergasheva', company: 'Navroʻz Trade', last: 'Thanks, all received 👍', when: 'Mon', unread: 0, online: true },
  { id: 'shirin', name: 'Timur Khasanov', company: 'Shirin Dunyo', last: 'Please cancel SO-1038', when: 'Sun', unread: 0, online: false },
]

export type Message = { id: number; me: boolean; text: string; time: string }
export const firstMessages: Message[] = [
  { id: 1, me: false, text: 'Hello! Is order SO-1042 ready? We are running low on water.', time: '10:21' },
  { id: 2, me: true, text: 'Hi Sardor, it is packed. The driver leaves at 9 tomorrow.', time: '10:24' },
  { id: 3, me: false, text: 'Great. Can you also add 20 boxes of Lipton tea?', time: '10:30' },
  { id: 4, me: true, text: 'Yes, I added them to the same order. New total is 51.8M soʻm.', time: '10:33' },
  { id: 5, me: false, text: 'Can you deliver on Saturday?', time: '10:42' },
]
export const suggestions = ['Yes, Saturday works', 'Only Monday, sorry', 'I will check with the driver']
export const replies = ['Perfect, thank you!', 'Okay, see you then.', 'Thanks, let me know.']

export type Saved = { id: number; kind: 'Reports' | 'Views' | 'Links'; icon: string; tone: string; title: string; text: string; source: string; date: string }
export const saved: Saved[] = [
  { id: 1, kind: 'Reports', icon: 'chart', tone: 'blue', title: 'Debtors over 30 days', text: 'Clients with invoices older than a month, largest first.', source: 'Reports', date: 'Nov 4' },
  { id: 2, kind: 'Views', icon: 'layers', tone: 'gold', title: 'Low stock, Tashkent warehouse', text: 'Products below their minimum, grouped by supplier.', source: 'Inventory', date: 'Nov 3' },
  { id: 3, kind: 'Links', icon: 'file', tone: 'violet', title: 'Price list, November', text: 'The PDF we send to new clients.', source: 'Drive', date: 'Nov 1' },
  { id: 4, kind: 'Reports', icon: 'cash', tone: 'green', title: 'Sales by agent', text: 'Who sold what this month, with returns subtracted.', source: 'Reports', date: 'Oct 30' },
  { id: 5, kind: 'Views', icon: 'truck', tone: 'red', title: 'Deliveries due today', text: 'Orders packed and waiting for a driver.', source: 'Orders', date: 'Oct 29' },
  { id: 6, kind: 'Links', icon: 'receipt', tone: 'blue', title: 'Didox login', text: 'Where we sign e-invoices.', source: 'didox.uz', date: 'Oct 21' },
  { id: 7, kind: 'Reports', icon: 'box', tone: 'gold', title: 'Top 20 products', text: 'Best sellers by revenue and by margin.', source: 'Reports', date: 'Oct 18' },
  { id: 8, kind: 'Views', icon: 'star', tone: 'violet', title: 'Key clients', text: 'The 15 clients that bring 60% of sales.', source: 'Clients', date: 'Oct 12' },
]

// "Dilnoza Saidova" -> "DS", "Dilnoza" -> "D"; codes like "AK" stay as they are.
export const initials = (name: string) =>
  name.includes(' ') ? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() : name.length <= 2 ? name : name[0].toUpperCase()
