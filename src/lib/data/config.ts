/** Validated /data/config. Import config from here, never the JSON directly. */
import balanceJson from '@data/config/balance.json'
import copyJson from '@data/config/copy.json'
import layoutJson from '@data/config/layout.json'
import moderationJson from '@data/config/moderation.json'
import onboardingJson from '@data/config/onboarding.json'
import perfJson from '@data/config/perf.json'
import realtimeJson from '@data/config/realtime.json'
import sceneJson from '@data/config/scene.json'
import themeJson from '@data/config/theme.json'
import { parseDataFile } from './parse'
import {
  BalanceConfigSchema,
  CopyConfigSchema,
  LayoutConfigSchema,
  ModerationConfigSchema,
  OnboardingConfigSchema,
  PerfConfigSchema,
  RealtimeConfigSchema,
  ThemeConfigSchema,
} from './schemas/config'
import { SceneConfigSchema } from './schemas/scene'

export const balance = parseDataFile('config/balance.json', BalanceConfigSchema, balanceJson)
export const copyConfig = parseDataFile('config/copy.json', CopyConfigSchema, copyJson)
export const layout = parseDataFile('config/layout.json', LayoutConfigSchema, layoutJson)
export const moderation = parseDataFile(
  'config/moderation.json',
  ModerationConfigSchema,
  moderationJson,
)
export const onboarding = parseDataFile(
  'config/onboarding.json',
  OnboardingConfigSchema,
  onboardingJson,
)
export const perf = parseDataFile('config/perf.json', PerfConfigSchema, perfJson)
export const realtime = parseDataFile('config/realtime.json', RealtimeConfigSchema, realtimeJson)
export const theme = parseDataFile('config/theme.json', ThemeConfigSchema, themeJson)
export const scene = parseDataFile('config/scene.json', SceneConfigSchema, sceneJson)
