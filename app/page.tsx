import XsmbApp from '@/components/xsmb-app'

export const dynamic = 'force-dynamic'

function getVietnamDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offsetDays),
  )
  return date.toISOString().slice(0, 10)
}

export default function Page() {
  return <XsmbApp todayDate={getVietnamDate()} initialTargetDate={getVietnamDate(1)} />
}
