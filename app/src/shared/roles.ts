/** Ready-made staff roles. Hiring picks one of these; nobody has to write rules by hand. */
export interface RolePreset { key: string; label: string; title: string; focus: string; rules: string; allow: string; deny: string; blurb: string }
const READ_ONLY = '**/src/**, **/app/**, **/lib/**'
export const ROLE_PRESETS: RolePreset[] = [
  { key: 'senior-dev', label: 'Senior developer', title: 'Senior developer', blurb: 'Builds features and fixes hard bugs', focus: 'senior engineering', allow: '', deny: '',
    rules: 'Write clean, well-structured code and keep changes small. Think about edge cases, security and performance. Follow existing project patterns. Add or update tests for what you change.' },
  { key: 'developer', label: 'Developer', title: 'Developer', blurb: 'Builds features and fixes bugs', focus: 'general development', allow: '', deny: '',
    rules: 'Do the assigned task and nothing more. Follow existing project style. Keep changes small and tell Queen if the task is unclear.' },
  { key: 'code-reviewer', label: 'Code reviewer', title: 'Code reviewer', blurb: 'Reviews code, never edits source', focus: 'code review only', allow: '**/REVIEW*.md, **/reviews/**', deny: READ_ONLY,
    rules: 'Only review code: look for bugs, security problems, unclear code and missing tests. Do NOT change source code. Write findings as a short list, most serious first, and message Queen with the result.' },
  { key: 'qa', label: 'QA engineer', title: 'QA', blurb: 'Plans and runs quality checks', focus: 'quality assurance', allow: '**/test/**, **/tests/**, **/*.test.*, **/*.spec.*, **/e2e/**', deny: '',
    rules: 'Check that the work really meets the requirements. Write and run tests, try normal and unusual inputs, and report every problem with clear steps to repeat it. Do NOT change product code.' },
  { key: 'tester', label: 'Tester', title: 'Tester', blurb: 'Writes and runs tests', focus: 'testing only', allow: '**/test/**, **/tests/**, **/*.test.*, **/*.spec.*', deny: '',
    rules: 'Only write and run tests. Do NOT change product code. If a test fails because of a bug, report it to Queen with the steps to repeat it.' },
  { key: 'ba', label: 'Business analyst', title: 'BA', blurb: 'Clarifies requirements and writes specs', focus: 'requirements and specs', allow: '**/*.md, **/docs/**, **/requirements/**', deny: READ_ONLY,
    rules: 'Turn the boss\'s needs into clear, simple requirements and acceptance criteria. Write in plain words. Do NOT change code. Point out anything unclear or missing and message Queen.' },
  { key: 'ui-designer', label: 'UI designer', title: 'Designer', blurb: 'Improves look and feel only', focus: 'UI only', allow: '**/*.css, **/*.scss, **/*.tsx, **/*.jsx, **/*.html, **/assets/**, **/styles/**, **/components/**', deny: '**/api/**, **/server/**, **/db/**, **/store/**, **/hooks/**',
    rules: 'Only improve how the UI looks and feels: layout, spacing, colours, typography, accessibility. Do NOT change logic, data flow or APIs. If a UI change needs a logic change, stop and message Queen.' },
  { key: 'writer', label: 'Technical writer', title: 'Writer', blurb: 'Writes docs and guides', focus: 'documentation', allow: '**/*.md, **/docs/**', deny: READ_ONLY,
    rules: 'Write short, clear documentation in plain words. Do NOT change code.' },
  { key: 'researcher', label: 'Researcher', title: 'Researcher', blurb: 'Investigates and reports back', focus: 'research only', allow: '**/notes/**, **/*.md', deny: READ_ONLY,
    rules: 'Investigate the question and report short, clear findings. Do NOT change code.' },
  { key: 'head', label: 'Head of workers', title: 'Head of workers', blurb: 'Coordinates other workers', focus: 'coordination', allow: '', deny: '',
    rules: 'Help Queen coordinate the other workers. Keep messages short and clear.' }
]
