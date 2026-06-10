/**
 * Resources
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { Mail } from 'lucide-react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

/**
 * Dependencies
 */
import { useInviteUser, useInviteUserSchema } from '@/hooks/api/accounts/mutations/useInviteUserCreate'
import { useInvitedUsers } from '@/hooks/api/invitations/queries/useInvitedUsers'

/**
 * Components
 */
import { FloatingLabelInput } from '@/components/ui/custom/floating-label-input'
import { WaveButton } from '@/components/ui/custom/wave-button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/shadcn/dialog'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/shadcn/form'

import type { InviteUserPayloadDto } from '@/hooks/api/accounts/mutations/useInviteUserCreate'

type InviteAccountOwnerDialogProps = {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

function capitalize(s: string) {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Generate a sensible default account name from what we know about the invitee.
 * Falls back through firstname+lastname → firstname → email user-part → "Main account".
 */
function suggestAccountName(firstname?: string, lastname?: string, email?: string): string {
  const fn = firstname?.trim()
  const ln = lastname?.trim()
  if (fn && ln) return `${capitalize(fn)} ${capitalize(ln)}'s account`
  if (fn) return `${capitalize(fn)}'s account`
  const e = email?.trim()
  if (e && e.includes('@')) {
    const userPart = e.split('@')[0].split('+')[0]
    const firstToken = userPart.split(/[._-]/)[0]
    if (firstToken) return `${capitalize(firstToken)}'s account`
  }
  return 'Main account'
}

/**
 * Platform-admin only — invites someone to **create their own account** on the platform.
 *
 * The backend detects this flow when the invitation has zero account/entity targets and the
 * caller holds `ACCOUNT_INVITE_OWNER`. At acceptance time, a fresh Account is provisioned and
 * the invitee is auto-promoted to admin (ACCOUNT scope) of that new account.
 */
export function InviteAccountOwnerDialog({ isOpen, onOpenChange }: InviteAccountOwnerDialogProps) {
  const { t: tAccount } = useTranslation('account')
  const { t: tCommon } = useTranslation('common')
  const baseInviteSchema = useInviteUserSchema()
  // Reuse the existing invitation payload schema, with no account/entity/role fields visible to the user.
  const formSchema = baseInviteSchema.payload
  type FormValues = z.infer<typeof formSchema>

  const inviteUser = useInviteUser()
  const { refetch: refreshInvitations } = useInvitedUsers()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      firstname: '',
      lastname: '',
      accountName: '',
      roleIds: [],
      entityIds: [],
      accountIds: []
    }
  })

  // Live-suggest an account name based on the invitee's identity. We only auto-fill while the
  // user has not manually overridden the field (we track that via a `dirtyFields` flag from RHF).
  const watchedFirstname = form.watch('firstname')
  const watchedLastname = form.watch('lastname')
  const watchedEmail = form.watch('email')
  useEffect(() => {
    if (form.formState.dirtyFields.accountName) return
    const suggested = suggestAccountName(watchedFirstname, watchedLastname, watchedEmail)
    form.setValue('accountName', suggested, { shouldDirty: false })
  }, [watchedFirstname, watchedLastname, watchedEmail, form])

  const handleSubmit = async (data: FormValues) => {
    const payload: InviteUserPayloadDto = {
      email: data.email,
      firstname: data.firstname,
      lastname: data.lastname,
      accountName: data.accountName?.trim() || undefined,
      // Empty targets — the backend will detect the account-owner flow via ACCOUNT_INVITE_OWNER
      // and create a fresh account at acceptance time.
      roleIds: [],
      accountIds: [],
      entityIds: []
    }
    try {
      await inviteUser.submitAsync(payload)
      refreshInvitations()
      form.reset()
      onOpenChange(false)
    } catch (error) {
      console.error('Failed to invite account owner', error)
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) form.reset()
        onOpenChange(open)
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{tAccount('dialogs.inviteOwner.tk_title_')}</DialogTitle>
          <DialogDescription>{tAccount('dialogs.inviteOwner.tk_description_')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 mt-3">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <FloatingLabelInput label={tCommon('user.tk_email_')} type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="firstname"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <FloatingLabelInput label={tCommon('user.tk_firstName_')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastname"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <FloatingLabelInput label={tCommon('user.tk_lastName_')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="accountName"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <FloatingLabelInput
                      label={tAccount('dialogs.inviteOwner.tk_account-name_')}
                      {...field}
                      onChange={(e) => {
                        // Mark dirty so the auto-suggest stops overwriting once the user edits.
                        form.setValue('accountName', e.target.value, { shouldDirty: true })
                      }}
                    />
                  </FormControl>
                  <p className="text-[11px] text-muted-foreground mt-1">{tAccount('dialogs.inviteOwner.tk_account-name-hint_')}</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-[11px] text-muted-foreground">{tAccount('dialogs.inviteOwner.tk_hint_')}</p>

            <DialogFooter>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="cursor-pointer rounded-[2px] border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {tCommon('actions.tk_cancel_')}
              </button>
              <WaveButton type="submit" disabled={inviteUser.isLoading}>
                <Mail className="h-3.5 w-3.5" />
                {inviteUser.isLoading ? tCommon('actions.tk_loading_') : tAccount('dialogs.inviteOwner.tk_submit_')}
              </WaveButton>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
