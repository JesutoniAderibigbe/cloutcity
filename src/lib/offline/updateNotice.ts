/**
 * When the update notice (S04e, data-cc-notice "update") shows: a new build is waiting, the
 * player has not put it off this session, and nothing more important holds the screen. A modal
 * (the welcome card, the Icon moment) and the first-run tour (S06, GR-9) each come first; the
 * notice shows once they are gone.
 */
export interface UpdateNoticeState {
  readonly waiting: boolean
  readonly dismissed: boolean
  readonly modalOpen: boolean
  readonly touring: boolean
}

export function updateNoticeShown(state: UpdateNoticeState): boolean {
  return state.waiting && !state.dismissed && !state.modalOpen && !state.touring
}
