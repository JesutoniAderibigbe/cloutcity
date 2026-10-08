/** Registers the `townsfolk.*` copy namespace (data/copy/townsfolk). Import it where used. */
import base from '@data/copy/townsfolk/base.json'
import { registerCopy } from '../registry'

registerCopy('townsfolk', base, {})
