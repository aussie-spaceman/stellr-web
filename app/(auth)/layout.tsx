/** Sign-in and sign-up: Clerk's card on its own, inside the page's main landmark. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <main id="main">{children}</main>
}
