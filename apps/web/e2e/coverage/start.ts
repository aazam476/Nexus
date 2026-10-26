// Before the browser tests: forget coverage from earlier runs.
import MCR from 'monocart-coverage-reports'
import { coverageOptions } from './options.ts'

export default async function start() {
  MCR(coverageOptions).cleanCache()
}
