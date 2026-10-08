/** Registers the `buy.*` copy namespace (data/copy/buy, S40 buy mode). Import it where the copy is used. */
import base from '@data/copy/buy/base.json'
import nycPack from '@data/copy/buy/nyc.json'
import { registerCopy } from '../registry'

registerCopy('buy', base, { nyc: nycPack })
