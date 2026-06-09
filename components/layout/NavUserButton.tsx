'use client'

import { UserButton } from '@clerk/nextjs'
import { Shield } from 'lucide-react'

export function NavUserButton({ isAdmin }: { isAdmin: boolean }) {
  return (
    <UserButton>
      {isAdmin && (
        <UserButton.MenuItems>
          <UserButton.Link
            label="Admin panel"
            labelIcon={<Shield size={14} />}
            href="/admin"
          />
        </UserButton.MenuItems>
      )}
    </UserButton>
  )
}
