export default function FieldError({ message, id }: { message?: string; id?: string }) {
  if (!message) return null
  // deep review PUB-10 (WCAG 3.3.1 / 4.1.3): role="alert" makes the validation
  // message a live region so assistive tech announces it when it appears after a
  // failed submit — otherwise the error is silent to screen-reader users across
  // every public form that uses this component.
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-600">
      {message}
    </p>
  )
}
