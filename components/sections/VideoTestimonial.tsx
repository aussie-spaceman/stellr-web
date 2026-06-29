/**
 * Responsive self-hosted video embed used for testimonial clips. Files live in
 * /public/videos (web-optimized H.264 MP4 + a poster frame). Render inside a
 * page-styled <section> for the surrounding heading.
 */
export function VideoTestimonial({
  src,
  poster,
  title = 'Stellr testimonial',
  className = '',
}: {
  src: string
  poster?: string
  title?: string
  className?: string
}) {
  return (
    <div
      className={`relative aspect-video w-full overflow-hidden rounded-2xl border border-line bg-black shadow-card-lift ${className}`}
    >
      <video
        controls
        preload="metadata"
        poster={poster}
        title={title}
        className="absolute inset-0 h-full w-full"
      >
        <source src={src} type="video/mp4" />
        Your browser doesn&rsquo;t support embedded video.
      </video>
    </div>
  )
}
