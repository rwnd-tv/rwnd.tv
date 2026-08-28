import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from './Field.js'

describe('Field', () => {
  it('omits the error alert when no error is given', () => {
    render(<Field label="Email" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'false')
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-describedby')
  })

  it('shows the error as an alert wired to the input via aria-describedby', () => {
    render(<Field label="Email" error="Email is required" />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Email is required')

    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', alert.id)
  })

  it('resolves the label to the input whether the id is generated or explicitly passed', () => {
    const { rerender } = render(<Field label="Password" />)
    expect(screen.getByLabelText('Password')).toBeInstanceOf(HTMLInputElement)

    rerender(<Field label="Password" id="custom-password-id" />)
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('id', 'custom-password-id')
  })
})
