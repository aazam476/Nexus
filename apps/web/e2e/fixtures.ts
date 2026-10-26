// What every browser test gets automatically:
//  - coverage: which lines of the app ran, collected from Chromium
//  - a check that the page had no JavaScript errors and showed no alert() or prompt()
//    (an email that manages to run a script would show up here). The app's own "Delete this…?"
//    confirm() questions are answered yes, as a person would.
// And on request, `person()`: a second, separate browser (another user on another computer)
// that gets the same coverage and checks.
import { test as base, expect, type Page } from '@playwright/test'
import MCR from 'monocart-coverage-reports'
import { coverageOptions } from './coverage/options.ts'

async function watch(page: Page, problems: string[]) {
  page.on('pageerror', (error) => problems.push(`JavaScript error: ${error.message}`))
  page.on('dialog', async (dialog) => {
    if (dialog.type() === 'confirm') return dialog.accept()
    // The editor's Link button asks for the address this way.
    if (dialog.type() === 'prompt' && dialog.message() === 'Link address')
      return dialog.accept('https://example.com/docs')
    problems.push(`Unexpected ${dialog.type()}: ${dialog.message()}`)
    await dialog.dismiss()
  })
  await page.coverage.startJSCoverage({ resetOnNavigation: false })

  // Every full page load runs a fresh copy of the app under the same URL, and the coverage report
  // keeps only one copy per URL. So save what ran so far before goto() and reload() load a new one.
  const save = async () => {
    await MCR(coverageOptions).add(await page.coverage.stopJSCoverage())
    await page.coverage.startJSCoverage({ resetOnNavigation: false })
  }
  const goto = page.goto.bind(page)
  const reload = page.reload.bind(page)
  page.goto = async (...args) => (await save(), goto(...args))
  page.reload = async (...args) => (await save(), reload(...args))
}

export const test = base.extend<{ watchPage: void; person: () => Promise<Page> }>({
  watchPage: [
    async ({ page }, use) => {
      const problems: string[] = []
      await watch(page, problems)
      await use()
      await MCR(coverageOptions).add(await page.coverage.stopJSCoverage())
      expect(problems).toEqual([])
    },
    { auto: true },
  ],

  person: async ({ browser, baseURL }, use) => {
    const pages: Page[] = []
    const problems: string[] = []
    await use(async () => {
      // An empty session: not the admin's saved sign-in, which new windows would otherwise inherit.
      const page = await (await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } })).newPage()
      await watch(page, problems)
      pages.push(page)
      return page
    })
    for (const page of pages) {
      await MCR(coverageOptions).add(await page.coverage.stopJSCoverage())
      await page.context().close()
    }
    expect(problems).toEqual([])
  },
})

export { expect }
