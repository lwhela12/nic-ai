const isValidDateParts = (year: number, month: number, day: number): boolean => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false

  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

const normalizeDateInput = (value: string | Date | number): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const trimmed = value.trim()
  if (!trimmed) return null

  const isoDateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoDateOnly) {
    const year = Number(isoDateOnly[1])
    const month = Number(isoDateOnly[2])
    const day = Number(isoDateOnly[3])
    if (!isValidDateParts(year, month, day)) return null
    return new Date(year, month - 1, day)
  }

  const mdy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (mdy) {
    const month = Number(mdy[1])
    const day = Number(mdy[2])
    let year = Number(mdy[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    if (!isValidDateParts(year, month, day)) return null
    return new Date(year, month - 1, day)
  }

  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

export const formatDateMMDDYYYY = (
  value: string | Date | number,
  fallback = '—'
): string => {
  const parsed = normalizeDateInput(value)
  if (!parsed) return fallback
  return `${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}-${parsed.getFullYear()}`
}

