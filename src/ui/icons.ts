/**
 * Material Symbols Rounded (weight 400, outline) used by the app. `pnpm icons` builds `public/icons.svg`
 * from this list; CI fails if the sprite is stale. Add a name here before using it in <Icon>.
 */
export const ICONS = [
  // block types
  "call",
  "groups",
  "self_improvement",
  "fitness_center",
  "restaurant",
  "menu_book",
  "school",
  "pets",
  "favorite",
  "bedtime",
  "storefront",
  "sports_tennis",
  "more_horiz",
  // block state & source
  "radio_button_unchecked",
  "radio_button_checked",
  "check_circle",
  "do_not_disturb_on",
  "event",
  "auto_awesome",
  "person",
  "lock",
  "edit",
  "update",
  "event_busy",
  // actions
  "chat",
  "add",
  "check",
  "close",
  "drag_indicator",
  "chevron_left",
  "chevron_right",
  "open_in_new",
  "flag",
  "notes",
  "notifications",
  "schedule",
  "undo",
  "more_time",
  "swap_horiz",
  // banners & sync
  "info",
  "cloud_off",
  "sync_problem",
  "sync",
  // tabs
  "today",
  "checklist",
  "calendar_month",
  "insights",
  "settings",
  // habits & stats
  "local_fire_department",
  "trending_up",
  // auth
  "fingerprint",
  "backspace",
  "key",
  "devices",
  // sleep
  "wb_twilight",
  "dark_mode",
  "light_mode",
  // misc
  "download",
  "attach_file",
  "sell",
  "timer",
] as const;

export type IconName = (typeof ICONS)[number];
