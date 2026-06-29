/**
 * Responsive Google Drive video embed used for testimonial clips. The Drive
 * file must be shared with "Anyone with the link" for the /preview player to
 * load. Render inside a page-styled <section> for the surrounding heading.
 */
export function VideoTestimonial({
  fileId,
  title = 'Stellr testimonial',
  className = '',
}: {
  fileId: string
  title?: string
  className?: string
}) {
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black shadow-card-lift ${className}`}
    >
      <iframe
        src={`https://drive.google.com/file/d/${fileId}/preview`}
        title={title}
        allow="autoplay; fullscreen"
        allowFullScreen
        className="absolute inset-0 h-full w-full"
      />
    </div>
  )
}
