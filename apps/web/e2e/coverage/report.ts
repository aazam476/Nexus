// After the browser tests: turn what each page ran into a coverage report (coverage-e2e/).
import MCR from 'monocart-coverage-reports'
import { coverageOptions } from './options.ts'

export default async function report() {
  await MCR(coverageOptions).generate()
}
