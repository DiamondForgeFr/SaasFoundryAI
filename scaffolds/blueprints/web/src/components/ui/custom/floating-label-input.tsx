import { Eye, EyeOff } from 'lucide-react'
import { forwardRef, useId, useState } from 'react'

import { cn } from '@/utils/ui'
import { Input } from '@/components/ui/shadcn/input'

interface FloatingLabelInputProps extends Omit<React.ComponentProps<'input'>, 'placeholder'> {
  label: string
}

export const FloatingLabelInput = forwardRef<HTMLInputElement, FloatingLabelInputProps>(({ label, className, id, ...props }, ref) => {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className="fl-wrap">
      <Input id={inputId} placeholder=" " className={cn('fl-input h-11', className)} ref={ref} {...props} />
      <label htmlFor={inputId} className="fl-label">
        {label}
      </label>
    </div>
  )
})
FloatingLabelInput.displayName = 'FloatingLabelInput'

type FloatingLabelPasswordInputProps = Omit<FloatingLabelInputProps, 'type'>

export const FloatingLabelPasswordInput = forwardRef<HTMLInputElement, FloatingLabelPasswordInputProps>(({ label, className, id, ...props }, ref) => {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [show, setShow] = useState(false)

  return (
    <div className="fl-wrap">
      <div className="relative">
        <Input id={inputId} type={show ? 'text' : 'password'} placeholder=" " className={cn('fl-input h-11 pr-10', className)} ref={ref} {...props} />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setShow((v) => !v)}
          tabIndex={-1}
          className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 z-10 flex items-center px-3 focus:outline-none"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <label htmlFor={inputId} className="fl-label">
        {label}
      </label>
    </div>
  )
})
FloatingLabelPasswordInput.displayName = 'FloatingLabelPasswordInput'
