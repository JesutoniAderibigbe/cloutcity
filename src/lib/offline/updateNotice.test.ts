import { describe, expect, it } from 'vitest'
import { updateNoticeShown, type UpdateNoticeState } from './updateNotice'

const WAITING: UpdateNoticeState = {
  waiting: true,
  dismissed: false,
  modalOpen: false,
  touring: false,
}

describe('updateNoticeShown', () => {
  it('shows when a new build waits and nothing else holds the screen', () => {
    expect(updateNoticeShown(WAITING)).toBe(true)
  })

  it('stays hidden with no waiting build, or once put off', () => {
    expect(updateNoticeShown({ ...WAITING, waiting: false })).toBe(false)
    expect(updateNoticeShown({ ...WAITING, dismissed: true })).toBe(false)
  })

  it('waits behind a modal and the tour, and shows once both are gone', () => {
    expect(updateNoticeShown({ ...WAITING, modalOpen: true })).toBe(false)
    expect(updateNoticeShown({ ...WAITING, touring: true })).toBe(false)
    expect(updateNoticeShown({ ...WAITING, modalOpen: true, touring: true })).toBe(false)
    // The same waiting build, after the tour ends and the modal closes.
    expect(updateNoticeShown({ ...WAITING, modalOpen: false, touring: false })).toBe(true)
  })
})
