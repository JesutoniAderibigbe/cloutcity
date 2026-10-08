/** Registers the `phone.*` copy namespace (data/copy/phone). Import it where the copy is used. */
import base from '@data/copy/phone/base.json'
import { registerCopy } from '../registry'

registerCopy('phone', base, {})
