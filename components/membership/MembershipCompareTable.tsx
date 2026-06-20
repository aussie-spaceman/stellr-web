'use client'

import { useState } from 'react'

type Tab = 'school' | 'college' | 'educators'

const TABS: { key: Tab; label: string }[] = [
  { key: 'school', label: 'School students' },
  { key: 'college', label: 'College' },
  { key: 'educators', label: 'Educators' },
]

function Check() {
  return <span className="text-[17px] text-enviro-green">✓</span>
}
function Dash() {
  return <span className="text-[17px] text-[#C8CEDE]">—</span>
}
function Part({ children }: { children: React.ReactNode }) {
  return <span className="text-[12.5px] font-bold text-primary">{children}</span>
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-display font-bold text-[13px] text-ink py-[14px] px-[18px] text-left border-b-2 border-line bg-surface">
      {children}
    </th>
  )
}
function ThC({ children }: { children: React.ReactNode }) {
  return (
    <th className="font-display font-bold text-[13px] text-ink py-[14px] px-[18px] text-center border-b-2 border-line bg-surface min-w-[130px]">
      {children}
    </th>
  )
}
function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="py-3 px-[18px] border-b border-line-light text-[14px] text-content-secondary align-middle">
      {children}
    </td>
  )
}
function TdC({ children }: { children: React.ReactNode }) {
  return (
    <td className="py-3 px-[18px] border-b border-line-light text-center align-middle">
      {children}
    </td>
  )
}
function GroupRow({ label, cols }: { label: string; cols: number }) {
  return (
    <tr>
      <td
        colSpan={cols}
        className="py-[9px] px-[18px] bg-surface font-display font-bold text-[11.5px] uppercase tracking-[.06em] text-content-faint"
      >
        {label}
      </td>
    </tr>
  )
}

function SchoolTable() {
  return (
    <>
      <div className="bg-white border border-line rounded-2xl overflow-hidden">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <Th><span className="min-w-[230px] inline-block">Feature</span></Th>
              <ThC>Explorer<br /><span className="font-normal text-[12px] text-content-faint">Free</span></ThC>
              <ThC>Pathfinder<br /><span className="font-normal text-[12px] text-content-faint">$60/yr</span></ThC>
              <ThC>Scholar<br /><span className="font-normal text-[12px] text-content-faint">$500/yr</span></ThC>
            </tr>
          </thead>
          <tbody>
            <GroupRow label="Access" cols={4} />
            <tr><Td>Community Spaces</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Training materials library</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Webinar invites</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Competition entry</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <GroupRow label="Mentoring & Coaching" cols={4} />
            <tr><Td>Quarterly mentoring cohorts</Td><TdC><Dash /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Included 1:1 coaching sessions</Td><TdC><Dash /></TdC><TdC><Dash /></TdC><TdC><Part>5 × 30 min</Part></TdC></tr>
            <tr><Td>Coaching &amp; mentoring discount</Td><TdC><Dash /></TdC><TdC><Part>25%</Part></TdC><TdC><Part>30%</Part></TdC></tr>
            <GroupRow label="Recognition" cols={4} />
            <tr><Td>Proactive LinkedIn Support</Td><TdC><Dash /></TdC><TdC><Dash /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Store discount</Td><TdC><Part>5%</Part></TdC><TdC><Part>10%</Part></TdC><TdC><Part>10%</Part></TdC></tr>
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-content-faint mt-3 leading-[1.6]">
        Pathfinder and Scholar can be purchased directly, or earned — Pathfinder through competition participation, Scholar through award outcomes. All paid tiers revert to Explorer after 12 months.
      </p>
    </>
  )
}

function CollegeTable() {
  return (
    <>
      <div className="bg-white border border-line rounded-2xl overflow-hidden">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <Th><span className="min-w-[230px] inline-block">Feature</span></Th>
              <ThC>Alumni<br /><span className="font-normal text-[12px] text-content-faint">Free</span></ThC>
              <ThC>Contributor<br /><span className="font-normal text-[12px] text-content-faint">$250/yr</span></ThC>
              <ThC>Counselor<br /><span className="font-normal text-[12px] text-content-faint">$500/yr</span></ThC>
            </tr>
          </thead>
          <tbody>
            <GroupRow label="Access" cols={4} />
            <tr><Td>Community Spaces</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Training materials library</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Webinar invites</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Competition entry</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <GroupRow label="Mentoring & Coaching" cols={4} />
            <tr><Td>Semester-long mentoring cohort</Td><TdC><Dash /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Included 1:1 coaching sessions</Td><TdC><Dash /></TdC><TdC><Dash /></TdC><TdC><Part>2 × 30 min</Part></TdC></tr>
            <tr><Td>Coaching &amp; mentoring discount</Td><TdC><Dash /></TdC><TdC><Part>25%</Part></TdC><TdC><Part>30%</Part></TdC></tr>
            <GroupRow label="Recognition" cols={4} />
            <tr><Td>Proactive LinkedIn Support</Td><TdC><Dash /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Store discount</Td><TdC><Part>5%</Part></TdC><TdC><Part>10%</Part></TdC><TdC><Part>10%</Part></TdC></tr>
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-content-faint mt-3 leading-[1.6]">
        Contributor and Counselor can be purchased directly or earned through volunteer activity supporting Stellr. All paid tiers revert to Alumni after 12 months.
      </p>
    </>
  )
}

function EducatorTable() {
  return (
    <>
      <div className="bg-white border border-line rounded-2xl overflow-hidden">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <Th><span className="min-w-[230px] inline-block">Feature</span></Th>
              <ThC>Educator<br /><span className="font-normal text-[12px] text-content-faint">Free</span></ThC>
              <ThC>Innovator<br /><span className="font-normal text-[12px] text-content-faint">$500/yr</span></ThC>
              <ThC>Trailblazer<br /><span className="font-normal text-[12px] text-content-faint">$1,000/yr</span></ThC>
            </tr>
          </thead>
          <tbody>
            <GroupRow label="Community" cols={4} />
            <tr><Td>Educator Community Spaces</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Training materials</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Webinar invites &amp; newsletter</Td><TdC><Check /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <GroupRow label="Competition toolkit" cols={4} />
            <tr><Td>Assessment guides &amp; rubrics</Td><TdC><Dash /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Multi-week lesson plans</Td><TdC><Dash /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Live kick-off &amp; close-out calls</Td><TdC><Dash /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Student certificates</Td><TdC><Dash /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Student accounts upgraded to Pathfinder</Td><TdC><Dash /></TdC><TdC><Check /></TdC><TdC><Check /></TdC></tr>
            <GroupRow label="Professional development" cols={4} />
            <tr><Td>Bi-weekly mentoring calls</Td><TdC><Dash /></TdC><TdC><Dash /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>CPD credits &amp; hours</Td><TdC><Dash /></TdC><TdC><Dash /></TdC><TdC><Check /></TdC></tr>
            <tr><Td>Student awards</Td><TdC><Dash /></TdC><TdC><Dash /></TdC><TdC><Check /></TdC></tr>
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-content-faint mt-3 leading-[1.6]">
        Educator tier is free for all teachers. Innovator ($500/yr) is free in the first year as a competition participant. Trailblazer is for teachers looking to excel and grow professionally.
      </p>
    </>
  )
}

export function MembershipCompareTable() {
  const [active, setActive] = useState<Tab>('school')

  return (
    <div>
      <div className="flex gap-1 bg-line rounded-xl p-1 w-fit mb-8">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={[
              'px-5 py-[9px] rounded-[9px] font-display font-semibold text-[13.5px] transition-colors',
              active === tab.key
                ? 'bg-white text-ink shadow-sm'
                : 'bg-transparent text-content-faint hover:text-content-secondary',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === 'school' && <SchoolTable />}
      {active === 'college' && <CollegeTable />}
      {active === 'educators' && <EducatorTable />}
    </div>
  )
}
