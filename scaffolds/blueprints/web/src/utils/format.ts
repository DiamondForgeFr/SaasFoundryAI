/**
 * Formatting utilities
 */
import i18next from 'i18next'

/**
 * Format a date to a localized string
 * @param date - The date to format
 * @param locale - The locale to use (defaults to active i18next language)
 * @returns Formatted date string
 */
export function formatDate(date: Date | string, locale?: string): string {
  if (!date) return ''

  const dateObj = typeof date === 'string' ? new Date(date) : date

  return dateObj.toLocaleDateString(locale || i18next.language || undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

/**
 * Format a date in a long form (e.g. "January 5, 2026")
 * @param date - The date to format (string, Date, null, or undefined)
 * @param locale - The locale to use (defaults to active i18next language)
 * @returns Formatted date string or "—" when the date is missing
 */
export function formatDateLong(date: string | Date | null | undefined, locale?: string): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString(locale || i18next.language || undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

type FormatDateShortOptions = {
  withYear?: boolean
  locale?: string
}

/**
 * Format a date in a compact form. Default shape "Jan 5, 2026"; pass
 * `withYear: false` for "Jan 5" when the year is implied by context.
 * @param date - The date to format (string, Date, null, or undefined)
 * @param options - withYear (default true) + optional locale override
 * @returns Formatted date string or "—" when the date is missing
 */
export function formatDateShort(date: string | Date | null | undefined, { withYear = true, locale }: FormatDateShortOptions = {}): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString(locale || i18next.language || undefined, {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {})
  })
}

/**
 * Format a currency value
 * @param amount - The amount to format
 * @param currency - The currency code (defaults to EUR)
 * @param locale - The locale to use (defaults to browser locale)
 * @returns Formatted currency string
 */
export function formatCurrency(amount: number, currency = 'EUR', locale?: string): string {
  return new Intl.NumberFormat(locale || undefined, {
    style: 'currency',
    currency
  }).format(amount)
}

/**
 * Generate initials from a name
 * @param firstname - First name
 * @param lastname - Last name
 * @returns Initials (1-2 characters)
 */
export function getInitials(firstname?: string | null, lastname?: string | null): string {
  if (firstname && lastname) {
    return `${firstname[0]}${lastname[0]}`.toUpperCase()
  }
  if (firstname) {
    return firstname[0].toUpperCase()
  }
  if (lastname) {
    return lastname[0].toUpperCase()
  }
  return ''
}

/**
 * Truncate a string if it exceeds a maximum length
 * @param str - The string to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated string with ellipsis if needed
 */
export function truncate(str: string, maxLength: number): string {
  if (!str || str.length <= maxLength) return str || ''
  return `${str.slice(0, maxLength)}...`
}
