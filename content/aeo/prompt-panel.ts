/**
 * The fixed AEO prompt panel — the questions a US teacher (the first target
 * audience, decided 24 Sept 2026) asks an AI assistant, run monthly by
 * scripts/aeo-prompt-panel.ts.
 *
 * FIXED ON PURPOSE. Month-on-month comparison only means something if the
 * questions don't move. To change the panel, add a new prompt with a new id
 * and retire the old one (set `retired`) — never reword an existing prompt,
 * or its history stops being comparable.
 *
 * Brand prompts (`kind: 'brand'`) name Stellr and test how it is described;
 * category prompts don't, and test whether Stellr is recommended unprompted —
 * the number that actually moves when AEO works.
 */
export interface PanelPrompt {
  id: string
  kind: 'category' | 'brand'
  text: string
  retired?: true
}

export const PROMPT_PANEL: readonly PanelPrompt[] = [
  // Category — does Stellr come up without being named?
  { id: 'c01', kind: 'category', text: 'What are the best STEM competitions for high school students?' },
  { id: 'c02', kind: 'category', text: 'What engineering design competitions can my high school class enter?' },
  { id: 'c03', kind: 'category', text: 'Are there free STEM competitions for middle and high school students?' },
  { id: 'c04', kind: 'category', text: 'What space or aerospace competitions exist for high school students in the US?' },
  { id: 'c05', kind: 'category', text: 'What environmental or sustainability design challenges can high school students compete in?' },
  { id: 'c06', kind: 'category', text: 'How can I run an engineering design challenge in my classroom without a lab or engineering background?' },
  { id: 'c07', kind: 'category', text: 'Free NGSS-aligned engineering design lessons about space habitats for high school' },
  { id: 'c08', kind: 'category', text: 'What STEM competitions let students work with real industry professionals or mentors?' },
  { id: 'c09', kind: 'category', text: 'What are alternatives to Science Olympiad and FIRST Robotics for a school with no budget?' },
  { id: 'c10', kind: 'category', text: 'Virtual STEM competitions a teacher can run with their class during the school year' },
  { id: 'c11', kind: 'category', text: 'What STEM programs help high school students prepare for engineering careers, not just college?' },
  { id: 'c12', kind: 'category', text: 'Project-based learning ideas for a CTE engineering pathway class' },
  { id: 'c13', kind: 'category', text: 'How do industry-simulation competitions work for high school students?' },
  { id: 'c14', kind: 'category', text: 'STEM competitions in Colorado for high school students' },
  { id: 'c15', kind: 'category', text: 'Grants or funding for teachers to bring STEM competitions to their school' },
  // Brand — how is Stellr described when it is named?
  { id: 'b01', kind: 'brand', text: 'What is Stellr Education?' },
  { id: 'b02', kind: 'brand', text: 'Is the Stellr Space Design Challenge worth it for my students?' },
  { id: 'b03', kind: 'brand', text: 'How much does it cost to take part in a Stellr Education competition?' },
  { id: 'b04', kind: 'brand', text: 'How does Stellr Education compare to Science Olympiad?' },
  { id: 'b05', kind: 'brand', text: 'Does Stellr Education have free curriculum for teachers?' },
]

/**
 * Other programs whose appearance in an answer is recorded, for share of
 * voice. Deliberately excludes one family of space-settlement competitions —
 * a standing editorial decision (never name them in Stellr's public content),
 * applied here too so reports built from this data can't surface them.
 */
export const TRACKED_PROGRAMS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Science Olympiad', pattern: /science olympiad/i },
  { name: 'FIRST', pattern: /\bFIRST\b(?: (?:Robotics|Tech|LEGO))?/ },
  { name: 'VEX', pattern: /\bVEX\b/i },
  { name: 'TSA', pattern: /\bTSA\b|technology student association/i },
  { name: 'StellarXplorers', pattern: /stellar ?xplorers/i },
  { name: 'Future City', pattern: /future city/i },
  { name: 'NASA challenges', pattern: /NASA (?:TechRise|HERC|Human Exploration Rover|App Development|student challenge)/i },
  { name: 'eCYBERMISSION', pattern: /ecybermission/i },
]
