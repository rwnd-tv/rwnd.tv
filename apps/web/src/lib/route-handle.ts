/**
 * react-router's `handle` field on a route object — arbitrary data a route
 * can attach to itself, read back via `useMatches()` regardless of how
 * deeply it's nested. Used by Layout.tsx to size its container per route:
 * every page defaults to the existing 896px reading column, and a gallery
 * page opts into the full viewport width instead by setting `width: 'full'`.
 */
export interface RouteHandle {
  width?: 'default' | 'full'
}
