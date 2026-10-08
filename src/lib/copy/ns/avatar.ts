/**
 * Registers the `avatar.*` copy namespace (data/copy/avatar): the names of every look option in
 * data/avatar/options.json (skin tones, hairstyles, facial hair, head coverings, eyewear, ears,
 * outfits, heights). Import it where the creator or a look summary renders.
 */
import base from '@data/copy/avatar/base.json'
import { registerCopy } from '../registry'

registerCopy('avatar', base, {})
