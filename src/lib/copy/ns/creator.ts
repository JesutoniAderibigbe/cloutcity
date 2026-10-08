/**
 * Registers the `creator.*` copy namespace (data/copy/creator): the "Make it you" creator's steps,
 * offer, traits and the trait effect lines built from data/avatar/traits.json (GR-10).
 */
import base from '@data/copy/creator/base.json'
import nycPack from '@data/copy/creator/nyc.json'
import { registerCopy } from '../registry'

registerCopy('creator', base, { nyc: nycPack })
