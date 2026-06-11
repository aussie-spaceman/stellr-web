import Link from 'next/link'

/**
 * Slim footer for the member web app (app.stellreducation.org).
 * Only the legal bottom bar — the full marketing footer (newsletter band,
 * link columns) belongs to the public www site.
 */
export function AppFooter() {
  return (
    <footer className="bg-brand-blue-dark text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-500">
          <p>© 2026 Stellr Education. A 501(c)(3) nonprofit organization.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              Terms of Use
            </Link>
            <a
              href="mailto:hello@stellreducation.org"
              className="hover:text-white transition-colors"
            >
              hello@stellreducation.org
            </a>
          </div>
        </div>
      </div>
    </footer>
  )
}
