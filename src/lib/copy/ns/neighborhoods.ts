/**
 * Registers the `neighborhoods.*` copy namespace (data/copy/neighborhoods): the name and blurb of
 * each start neighborhood in data/homes/neighborhoods.json.
 */
import base from '@data/copy/neighborhoods/base.json'
import nycPack from '@data/copy/neighborhoods/nyc.json'
import { registerCopy } from '../registry'

registerCopy('neighborhoods', base, { nyc: nycPack })
