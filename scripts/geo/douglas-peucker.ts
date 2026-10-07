/**
 * Douglas-Peucker simplification for the geo build. The implementation lives in src/lib/geo so
 * the server's static fallback map (src/app/geo/fallback) simplifies outlines the same way.
 */
export { douglasPeucker } from '../../src/lib/geo/simplify.ts'
