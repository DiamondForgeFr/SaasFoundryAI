/**
 * Resources
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Types
 */
import type { FieldErrors, FieldPath, FieldValues, UseFormReturn } from 'react-hook-form'

type DisplayedError = { path: string; type: string }

/** Every displayed field error, as a dotted path (`organization.website`). Form-level `root` errors are not field errors. */
function listDisplayedErrors(errors: object, prefix = ''): DisplayedError[] {
  return Object.entries(errors).flatMap(([key, node]) => {
    if (!node || typeof node !== 'object' || (!prefix && key === 'root')) return []
    const path = prefix ? `${prefix}.${key}` : key
    // A field may itself be named `type`: an error carries a string there, a group of fields carries an object.
    const type = (node as { type?: unknown }).type
    return typeof type === 'string' ? [{ path, type }] : listDisplayedErrors(node, path)
  })
}

/**
 * Keeps the validation messages of a form in the current language (#983).
 *
 * A Zod schema holds translated messages, and React Hook Form keeps the error it displayed until the
 * field is validated again. This hook re-renders the form when the language changes, so `useForm`
 * receives the resolver built from the new schema, then validates again the fields that display an
 * error, and only those.
 *
 * `manualMessages` gives the current message of each error the form sets itself with `form.setError`,
 * by error type: no schema knows them, so validating again would clear them.
 */
export function useFormLanguageSync<TFieldValues extends FieldValues>(form: UseFormReturn<TFieldValues>, manualMessages: Record<string, string> = {}) {
  const { i18n } = useTranslation()
  const language = i18n.resolvedLanguage
  const messagesLanguage = useRef(language)
  const errors: FieldErrors<TFieldValues> = form.formState.errors

  useEffect(() => {
    if (messagesLanguage.current === language) return
    messagesLanguage.current = language

    const displayed = listDisplayedErrors(errors)
    for (const { path, type } of displayed) {
      if (type in manualMessages) form.setError(path as FieldPath<TFieldValues>, { type, message: manualMessages[type] })
    }
    const stale = displayed.filter(({ type }) => !(type in manualMessages)).map(({ path }) => path as FieldPath<TFieldValues>)
    if (stale.length > 0) void form.trigger(stale)
  }, [language, errors, form, manualMessages])
}
