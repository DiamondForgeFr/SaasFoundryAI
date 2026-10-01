/**
 * Resources
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Dependencies
 */
import { useBreadcrumb } from '@/hooks/ui/useBreadcrumb'

/**
 * React declaration
 */
export const Dashboard = () => {
  const { t: tDashboard } = useTranslation('dashboard')
  const { t: tCommon } = useTranslation('common')
  const { setBreadcrumb } = useBreadcrumb()

  useEffect(() => {
    setBreadcrumb([{ label: tDashboard('tk_title_') }])
  }, [setBreadcrumb, tDashboard])

  return (
    <div className="container mx-auto">
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h2 className="text-primary mb-4 text-3xl font-bold">{tDashboard('tk_title_')}</h2>
        <div className="max-w-2xl">
          <p className="text-muted-foreground mb-6 text-lg">{tCommon('work-in-progress.tk_page-under-construction_')}</p>
          <div className="bg-muted rounded-lg p-6">
            <p className="text-muted-foreground text-sm">{tCommon('work-in-progress.tk_coming-soon_')}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
