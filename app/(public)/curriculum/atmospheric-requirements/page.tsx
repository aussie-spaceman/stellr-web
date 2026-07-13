import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Hero, Button, CtaBand } from '@stellr/web-ui'
import { AtmosphericRequirements } from '@/components/interactive/atmospheric-requirements'
import { TUTORIAL_META } from '@/components/interactive/atmospheric-requirements/tutorial-data'

export const metadata: Metadata = {
  title: 'Atmospheric Requirements for Space Settlements — Tutorial',
  description:
    'Work out the air a space settlement needs: convert between total pressure, oxygen partial pressure and percent oxygen, weigh comfort against fire risk, and size the gas required — with interactive calculators.',
}

const AUTH_URL = process.env.NEXT_PUBLIC_AUTH_APP_URL ?? 'https://app.stellreducation.org'
const SIGNUP_URL = `${AUTH_URL}/sign-up`

// Page chrome only — the lesson body is the shared interactive component, which
// the Training course player also renders (registry key 'atmospheric-requirements').
export default function AtmosphericRequirementsPage() {
  return (
    <>
      <Hero
        breadcrumb="Curriculum · Tutorial"
        title="Estimating atmospheric requirements for space settlements"
        lead="Every settlement has to make its own air. In this tutorial you’ll size the atmosphere for a settlement — balancing what keeps people healthy, what keeps fires in check, and what it costs to ship and maintain."
        pills={[`⏱ ${TUTORIAL_META.time}`, `🎓 ${TUTORIAL_META.level}`, 'NGSS-aligned']}
      >
        <div className="flex flex-wrap gap-3 mt-8">
          <Button href="#start" variant="primary">
            Start the tutorial <ArrowRight size={16} />
          </Button>
          <Button href="/curriculum/atmospheric-requirements/teachers" as={Link} variant="outlineWhite">
            Teacher version
          </Button>
        </div>
      </Hero>

      <AtmosphericRequirements />

      <CtaBand
        title="Ready to design the whole settlement?"
        body="This tutorial is one piece of Stellr’s Space Design Challenge. Get the full material and run it with your class."
        actions={
          <>
            <Button href={SIGNUP_URL} variant="primary">
              Get the material — free
            </Button>
            <Button href="/curriculum/atmospheric-requirements/teachers" as={Link} variant="outlineWhite">
              Teacher version
            </Button>
          </>
        }
      />
    </>
  )
}
