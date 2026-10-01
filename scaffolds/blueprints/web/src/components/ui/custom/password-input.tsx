import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

import { Input } from '@/components/ui/shadcn/input'

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, 'type'> & {
  id?: string
}

export function PasswordInput({ id, ...props }: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)

  return (
    <div className="relative">
      <Input id={id} type={showPassword ? 'text' : 'password'} {...props} />
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 z-10 flex items-center px-3 focus:outline-hidden"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShowPassword(!showPassword)}
        tabIndex={-1}
      >
        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
