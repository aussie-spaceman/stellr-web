'use client'

import { UserButton } from '@clerk/nextjs'
import { Home } from 'lucide-react'

/** The admin header's account menu, with a way back to the member app. */
export function AdminUserButton() {
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link label="My Stellr" labelIcon={<Home className="h-4 w-4" />} href="/home" />
      </UserButton.MenuItems>
    </UserButton>
  )
}
