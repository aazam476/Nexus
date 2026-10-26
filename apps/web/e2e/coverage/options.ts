// Where browser-test coverage is collected and reported. Only the app's own src/ files count.
import type { CoverageReportOptions } from 'monocart-coverage-reports'

export const coverageOptions: CoverageReportOptions = {
  name: 'Nexus web app, browser tests',
  outputDir: './coverage-e2e',
  reports: ['console-summary', 'json-summary', 'html'],
  entryFilter: (entry) => entry.url.includes('/assets/'),
  sourceFilter: (path) => path.includes('src/') && !path.includes('node_modules'),
}
