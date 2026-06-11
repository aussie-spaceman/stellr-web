'use client'

import { UserButton } from '@clerk/nextjs'
import { Shield, Sparkles } from 'lucide-react'

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'

export function NavUserButton({ isAdmin }: { isAdmin: boolean }) {
  return (
    <UserButton>
      <UserButton.MenuItems>
        {/* First row — entry point to the member web app, also from www */}
        <UserButton.Link
          label="My Stellr"
          labelIcon={<Sparkles size={14} />}
          href={`${AUTH_URL}/community`}
        />
        {isAdmin && (
          <UserButton.Link
            label="Admin panel"
            labelIcon={<Shield size={14} />}
            href="/admin"
          />
        )}
      </UserButton.MenuItems>
    </UserButton>
  )
}
