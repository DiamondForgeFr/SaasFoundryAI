/**
 * Resources
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

/**
 * Dependencies
 */
import { KpiCard } from '@/components/ui/custom/kpi-card'

/**
 * Declaration
 */
describe('KpiCard', () => {
  it('renders the label, value and sub text', () => {
    render(<KpiCard icon={<svg data-testid="icon" />} label="Active users" value={42} sub="last 30 days" />)

    expect(screen.getByText('Active users')).toBeTruthy()
    expect(screen.getByText('42')).toBeTruthy()
    expect(screen.getByText('last 30 days')).toBeTruthy()
  })

  it('hides the alert dot by default and shows it when alert is set', () => {
    const { container, rerender } = render(<KpiCard icon={null} label="Pending" value="0" sub="none" />)
    expect(container.querySelector('.animate-pulse')).toBeNull()

    rerender(<KpiCard icon={null} label="Pending" value="0" sub="none" alert />)
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
  })
})
