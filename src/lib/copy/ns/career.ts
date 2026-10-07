/**
 * Registers the `career.*` copy namespace (data/copy/career): each career path's name, goal line
 * and bonus line, named by balance.json `career.paths`.
 */
import base from '@data/copy/career/base.json'
import nycPack from '@data/copy/career/nyc.json'
import { registerCopy } from '../registry'

registerCopy('career', base, { nyc: nycPack })
