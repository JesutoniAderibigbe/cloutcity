/** Registers the `players.*` copy namespace (data/copy/players). Import it where used. */
import base from '@data/copy/players/base.json'
import { registerCopy } from '../registry'

registerCopy('players', base, {})
