import { expect, test } from './fixtures/test'
import { bootAccountAs, meTab } from './helpers/account'
import { database } from './helpers/seed'
import { localStack } from './helpers/stack'

// S18a part 2 with DEC-61 accounts, opt-in (`npm run e2e:supabase`): against the local stack,
// "claude qa" typed at sign-up previews as @claude_qa and is saved exactly so (GR-6); the Me
// panel shows it; a taken handle and a filtered one are refused inline; a change inside the
// limit (the sign-up's own username was the free one) names the date it opens.

test.use({
  onboarding: 'fresh',
  // The refused change is a 429 from the database; the browser itself logs that.
  injectedConsoleErrors: [/status of 429 \(handle_change_limited\)/],
})
// One project only: the spec claims @claude_qa, which two parallel browsers would race for.
test.skip(({ isMobile }) => !isMobile, 'runs once, on mobile-390')

const stack = localStack()
// Opened and closed per group of tests: with fullyParallel, one worker can run this file's
// tests in several groups, and a connection ended after the first would fail the next.
let sql: ReturnType<typeof database>
test.beforeAll(() => {
  sql = database(stack)
})
test.afterAll(async () => {
  await sql.end()
})

// The shared stack keeps every handle: free claude_qa from earlier runs of this spec first.
test.beforeAll(async () => {
  await sql`delete from auth.users where id in (select user_id from public.handles where handle_key = 'claudeqa')`
  await sql`delete from public.handles where handle_key = 'claudeqa'`
})

test('the username typed at sign-up is the handle, @claude_qa exactly as previewed', async ({
  page,
  checkA11y,
}) => {
  test.setTimeout(120_000)
  await bootAccountAs(page, 'claude qa', async (form) => {
    await expect(form.locator('[data-username-preview]')).toContainText("You'll be @claude_qa")
    await expect(form).toContainText('Spaces, dots and dashes become underscores.')
  })
  const [row] = await sql<{ handle: string }[]>`
    select handle from public.handles where handle_key = 'claudeqa' and released_at is null
  `
  expect(row?.handle).toBe('claude_qa')

  await meTab(page).click()
  const me = page.getByRole('dialog', { name: 'Me' })
  const handle = me.locator('[data-me-handle]')
  await expect(handle).toHaveText('@claude_qa')
  await expect(me).toContainText('Level: Nobody')
  await expect(me.locator('[data-safety-lists]')).toContainText("You haven't blocked anyone.")
  await expect(me.locator('[data-me-account]')).toContainText('Signed in as')
  await checkA11y()

  const input = me.getByRole('textbox', { name: 'New handle' })
  // Taken: someone else's handle, found by the live check.
  const [other] = await sql<{ handle: string }[]>`
    select handle from public.profiles where handle is not null and handle <> 'claude_qa' limit 1
  `
  if (other === undefined) throw new Error('no other handle on the stack')
  await input.fill(other.handle)
  await expect(me.locator('[data-handle-error]')).toHaveText(
    'That handle is taken. Try another one.',
  )
  await expect(input).toHaveAttribute('aria-invalid', 'true')

  // Filtered: a reserved staff word.
  await input.fill('mod')
  await expect(me.locator('[data-handle-error]')).toHaveText(
    "That handle isn't allowed here. Pick something else.",
  )

  // A second change right after the free one is limited, and says when it opens.
  await expect(me.locator('[data-handle-allowance]')).toHaveText(
    /^Your next handle change opens on \w+ \d+, \d{4}\.$/,
  )
  // A generated-style name always passes the filter; the limit is checked before availability.
  await input.fill('BoldBodega77')
  await me.getByRole('button', { name: 'Save handle' }).click()
  await expect(me.locator('[data-handle-error]')).toHaveText(
    /^You changed your handle recently\. You can change it again on \w+ \d+, \d{4}\.$/,
  )
  await expect(input).toBeFocused()
})
