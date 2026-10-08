/**
 * Registers the `creatorOffer.*` copy namespace (data/copy/creatorOffer): the "Make it you"
 * offer toast (S16a), apart from the creator's own strings so the offer's chunk stays small.
 */
import base from '@data/copy/creatorOffer/base.json'
import nycPack from '@data/copy/creatorOffer/nyc.json'
import { registerCopy } from '../registry'

registerCopy('creatorOffer', base, { nyc: nycPack })
