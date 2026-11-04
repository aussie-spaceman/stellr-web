/**
 * GTM's container loader, as the exact text components/analytics/GoogleTagManager
 * hands next/script. lib/csp.ts hashes this same string for the nonce policy:
 * next/script injects it inline with no nonce (the App Router gives next/script
 * none), so a hash is the only way the policy can allow it. Any change to the
 * text changes the hash, and both sides read it from here.
 */
export function gtmInitScript(containerId: string): string {
  return (
    "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});" +
    "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';" +
    "j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);" +
    `})(window,document,'script','dataLayer','${containerId}');`
  )
}
