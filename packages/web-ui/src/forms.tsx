// Form primitives. Every form field on every surface goes through these, so a
// field always has: a label tied to it (tap the label, focus the field; a
// screen reader reads the label), hint and error text tied to it, a 16px font
// on touch screens (iOS Safari zooms the page into anything smaller), a 44px
// minimum height, and a border that meets the 3:1 contrast WCAG asks of a
// control's edge.
import * as React from 'react'
import { cn } from './primitives'

/** Shared look for text inputs, selects and textareas. */
export const fieldControlClass =
  'block w-full min-h-11 rounded-control border border-line-strong bg-white px-3 py-2 text-input text-ink ' +
  'placeholder:text-content-muted focus:border-primary-deep focus:outline-hidden focus:ring-2 focus:ring-primary-deep/30 ' +
  'disabled:cursor-not-allowed disabled:bg-surface disabled:text-content-muted aria-[invalid=true]:border-danger mouse:text-sm'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cn(fieldControlClass, className)} {...rest} />
  }
)

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    return <select ref={ref} className={cn(fieldControlClass, 'pr-8', className)} {...rest} />
  }
)

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(fieldControlClass, 'min-h-[5.5rem]', className)} {...rest} />
  }
)

type FieldProps = {
  label: React.ReactNode
  /** One control: Input, Select, Textarea, or any element that takes id/aria props. */
  children: React.ReactElement
  hint?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  className?: string
  /** Smaller, quieter label for dense sub-groups (e.g. emergency contact). */
  labelSize?: 'default' | 'small'
}

/**
 * A labelled control. Gives the child an id (unless it has one), points the
 * label at it, and wires hint and error text through aria-describedby, with
 * aria-invalid set while there is an error.
 */
export function Field({ label, children, hint, error, required, className, labelSize = 'default' }: FieldProps) {
  const autoId = React.useId()
  const child = React.Children.only(children) as React.ReactElement<Record<string, unknown>>
  const id = (child.props.id as string | undefined) ?? autoId
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy =
    [child.props['aria-describedby'] as string | undefined, hintId, errorId].filter(Boolean).join(' ') || undefined

  const control = React.cloneElement(child, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : child.props['aria-invalid'],
    required: required ?? child.props.required,
  })

  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <label
        htmlFor={id}
        className={cn(
          'block font-subheading font-medium',
          labelSize === 'small' ? 'text-xs text-content-muted' : 'text-sm text-content-body'
        )}
      >
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {' '}*
          </span>
        )}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-content-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

/** A checkbox or radio with its label, sized for a fingertip (44px row, 20px box). */
export const Choice = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { type?: 'checkbox' | 'radio'; label: React.ReactNode }
>(function Choice({ type = 'checkbox', label, className, ...rest }, ref) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-center gap-3 text-sm text-content-body', className)}>
      <input
        ref={ref}
        type={type}
        className="h-5 w-5 shrink-0 border-line-strong accent-primary-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-deep"
        {...rest}
      />
      <span className="min-w-0">{label}</span>
    </label>
  )
})

/** A group of choices (or related fields) under one legend. */
export function Fieldset({
  legend,
  children,
  hint,
  error,
  className,
}: {
  legend: React.ReactNode
  children: React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  className?: string
}) {
  const id = React.useId()
  return (
    <fieldset
      className={cn('min-w-0 space-y-1.5', className)}
      aria-describedby={[hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined}
    >
      <legend className="font-subheading text-sm font-medium text-content-body">{legend}</legend>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-content-muted">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}
