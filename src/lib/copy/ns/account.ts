/** Registers the `account.*` copy namespace (data/copy/account). Import it where the copy is used. */
import base from '@data/copy/account/base.json'
import { registerCopy } from '../registry'

registerCopy('account', base, {})
