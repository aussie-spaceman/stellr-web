import { StellrDocument, stellrMetadata, stellrViewport } from './document'

/*
 * Stellr's root layout, over every Stellr page in one route group, so moving between
 * (public), (flow), (auth), (member) and (admin) stays a client navigation. Next does
 * a full page load only when a navigation crosses root layouts. There are two others.
 * app/%5Ft/[tenant]/layout.tsx is one, which no Stellr page links to or shares a host
 * with. app/global-not-found.tsx is the other: a link on the 404 for a URL no page
 * answers is a full page load to the page it names. A page's own notFound() stays
 * under this root.
 */
export const metadata = stellrMetadata
export const viewport = stellrViewport

export default function StellrRootLayout({ children }: { children: React.ReactNode }) {
  return <StellrDocument>{children}</StellrDocument>
}
