// ---------------------------------------------------------------------------
// prayerAlarms.js — alarm-clock-style per-prayer alarm configuration
// ---------------------------------------------------------------------------
// A prayer alarm is NOT a global sound choice: each prayer (Fajr, Dhuhr, Asr,
// Maghrib, Isha) is its own alarm entry, exactly like a clock app:
//
//   { fajr:  { enabled: true, offsetMinutes: 0 } }  → rings AT the prayer time
//   { isha:  { enabled: true, offsetMinutes: 15 } } → rings 15 min BEFORE
//   { dhuhr: { enabled: false } }                   → no alarm
//
// `offsetMinutes` means "minutes before the prayer time" (0..120). Sunrise is
// display-only and never gets an alarm.
//
// Scheduling model (fits expo-notifications' 64-pending-notification limit):
//   • One DAILY repeating trigger per enabled alarm — rings every day, forever,
//     with zero rescheduling.
//   • Plus one-shot "catch-up" rings every 5 min (capped at 30 min) after each
//     ring for the next 7 days — like a real alarm clock that keeps ringing
//     until the user turns it off.
// Tapping any ring (or its ⏹ Stop button) cancels that day's remaining
// catch-up rings without touching the other prayers.
// ---------------------------------------------------------------------------

import { PermissionsAndroid, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { HIGH_ALARM_SOUND } from './notifications.js';

/** The prayers that can have alarms, in day order. Sunrise is excluded. */
export const ALARM_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Offset choices the UI offers, in minutes before the prayer time. */
export const ALARM_OFFSET_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];

/** How many days ahead one-shot "catch-up" rings are pre-scheduled. */
export const ALARM_DAYS = 7;

/** Minutes between the initial ring and each catch-up ring. */
export const RING_AGAIN_INTERVAL_MIN = 5;

/** Hard cap: catch-up rings stop this many minutes after the initial ring. */
export const RING_WINDOW_MIN = 30;

/** Android channel/category ids (v2: fresh ids so new settings always apply). */
export const ALARM_CHANNEL_ID = 'prayer-alarm-v2';
export const ALARM_CATEGORY_ID = 'prayer_alarm_v2';

/** Default configuration: every prayer rings AT its time, all enabled. */
export function defaultPrayerAlarms() {
  return {
    fajr: { enabled: true, offsetMinutes: 0 },
    dhuhr: { enabled: true, offsetMinutes: 0 },
    asr: { enabled: true, offsetMinutes: 0 },
    maghrib: { enabled: true, offsetMinutes: 0 },
    isha: { enabled: true, offsetMinutes: 0 },
  };
}

/**
 * Coerce any stored/partial shape into a safe, complete alarm config.
 * Unknown keys are ignored; bad offsets fall back to 0.
 * @param {object|undefined|null} raw
 */
export function sanitizePrayerAlarms(raw) {
  const d = defaultPrayerAlarms();
  if (!raw || typeof raw !== 'object') return d;
  const out = {};
  for (const key of ALARM_PRAYERS) {
    const r = raw[key];
    const off = Number(r && r.offsetMinutes);
    out[key] = {
      enabled: Boolean(r && r.enabled),
      offsetMinutes: Number.isFinite(off) && off >= 0 && off <= 120 ? off : 0,
    };
  }
  return out;
}

/** True when at least one alarm entry is enabled. */
export function anyAlarmEnabled(alarms) {
  const s = sanitizePrayerAlarms(alarms);
  return ALARM_PRAYERS.some((k) => s[k].enabled);
}

/**
 * Concrete fire time (minutes since midnight) for one alarm entry.
 * @returns {number|null} minutes since midnight, or null when unschedulable
 */
export function alarmFireMinutes(prayerTimes, prayerKey, offsetMinutes) {
  const base = prayerTimes ? prayerTimes[prayerKey] : undefined;
  if (!Number.isFinite(base)) return null;
  return Math.max(0, base - (offsetMinutes || 0));
}

/**
 * Build the notification content for one alarm ring.
 * @param {object} p
 * @param {string} p.prayerLabel  localized prayer name
 * @param {'tr'|'en'} p.language
 * @param {boolean} p.isCatchUp   true for "still ringing" follow-up rings
 * @param {string} p.chainId      id shared by all rings of one occurrence
 */
export function buildAlarmContent({ prayerLabel, language, isCatchUp, chainId }) {
  const title = language === 'tr' ? '⏰ Namaz Vakti' : '⏰ Prayer Alarm';
  const body = isCatchUp
    ? language === 'tr'
      ? `${prayerLabel} vakti — kapatmak için dokun`
      : `Time for ${prayerLabel} — tap to turn off`
    : language === 'tr'
      ? `${prayerLabel} namazı vakti geldi`
      : `It's time for ${prayerLabel} prayer`;
  return {
    title,
    body,
    // Sound comes from the loud Android alarm channel (bundled chime).
    sound: undefined,
    channelId: ALARM_CHANNEL_ID,
    // Shows the ⏹ Stop action button on the notification itself.
    categoryIdentifier: ALARM_CATEGORY_ID,
    data: { chainId, kind: 'prayer-alarm' },
  };
}

/**
 * Best-effort: on Android 12+ (API 31+) request the "Alarm & reminders"
 * capability so expo-notifications' exact/Date+Daily triggers actually fire on time.
 *
 * Declaring `SCHEDULE_EXACT_ALARM` in the manifest is not enough: on Android 14
 * (and on many OEM ROМs) it is a runtime app-operation that the user must grant,
 * otherwise the system may silently defer/in-exact the scheduled alarm. This call asks
 * once when an alarm is configured; if the user declines, scheduling still proceeds
 * (the OS will just fire it inexactly, exactly the previous behavior — no regression).
 */
async function ensureExactAlarmPermission() {
  try {
    if (Platform.OS === 'android' && Platform.Version >= 31) {
      const granted = await PermissionsAndroid.request(
        'android.permission.SCHEDULE_EXACT_ALARM'
      );
      if (!granted) {
        console.warn('Exact-alarm permission not granted — prayer alarms may be inexact.');
      }
    }
  } catch (e) {
    // Best-effort only; never let a permission hiccup break scheduling.

  }
}

/**
 * Schedule every enabled alarm from a per-prayer config.
 *
 * Replaces the legacy "one global sound mode" behaviour: notifications derive
 * from the per-prayer alarm entries (clock-app style) and always fire exactly
 * on the loud alarm channel.
 *
 * @param {object} p
 * @param {object} p.alarms       per-prayer config (see sanitizePrayerAlarms)
 * @param {object} p.prayerTimes  minutes-since-midnight map { fajr, dhuhr, ... }
 * @param {'tr'|'en'} p.language
 * @param {object} p.t            translations (prayer labels)
 * @returns {Promise<number>} how many notifications were scheduled
 */
export async function schedulePrayerAlarms({ alarms, prayerTimes, language, t }) {
  if (Platform.OS !== 'android') return 0;

  // Ask for the exact-alarm app-op so alarm rings on time on Android 12+.
  await ensureExactAlarmPermission();

  // Channels must exist BEFORE scheduling or Android falls back to defaults.
  await setupAlarmChannel();

  // Wipe everything previously scheduled (old alarms + legacy schedules).
  await Notifications.cancelAllScheduledNotificationsAsync();

  const config = sanitizePrayerAlarms(alarms);
  let scheduled = 0;

  for (const key of ALARM_PRAYERS) {
    const entry = config[key];
    if (!entry || !entry.enabled) continue;
    const fireMinutes = alarmFireMinutes(prayerTimes, key, entry.offsetMinutes);
    if (fireMinutes == null) continue;

    const hour = Math.floor(fireMinutes / 60);
    const minute = Math.floor(fireMinutes % 60);
    const label = (t && t[key]) || key;

    // 1) DAILY repeating trigger — the alarm fires every day at its time,
    //    forever, with no rescheduling (this is what makes it robust).
    await Notifications.scheduleNotificationAsync({
      content: buildAlarmContent({ prayerLabel: label, language, isCatchUp: false, chainId: `daily-${key}` }),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
    scheduled += 1;

    // 2) Catch-up rings for the NEXT occurrence only: when the user does not
    //    dismiss the alarm it rings again every 5 minutes (capped at 30 min).
    //    Tapping any ring cancels the rest of that occurrence's chain.
    //    (Only the next occurrence is pre-scheduled — Android caps pending
    //    notifications at 64; the daily trigger above covers every later day,
    //    and the app reschedules catch-ups whenever it is opened / times
    //    change.)
    const now = Date.now();
    let nextFire = null;
    for (let dayOffset = 0; dayOffset <= 1 && !nextFire; dayOffset++) {
      const fire = new Date();
      fire.setDate(fire.getDate() + dayOffset);
      fire.setHours(hour, minute, 0, 0);
      if (fire.getTime() > now) nextFire = fire;
    }
    if (nextFire) {
      const chainId = `${key}-${nextFire.getTime()}`;
      const reminderCount = Math.floor(RING_WINDOW_MIN / RING_AGAIN_INTERVAL_MIN);
      for (let r = 1; r <= reminderCount; r++) {
        const at = new Date(nextFire.getTime() + r * RING_AGAIN_INTERVAL_MIN * 60000);
        await Notifications.scheduleNotificationAsync({
          content: buildAlarmContent({ prayerLabel: label, language, isCatchUp: true, chainId }),
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
        });
        scheduled += 1;
      }
    }
  }
  return scheduled;
}

/**
 * Cancel every pending notification in one alarm chain (a single prayer
 * occurrence's catch-up rings). Called when a ring is tapped/stopped.
 * @param {string} chainId - e.g. 'fajr-1735689600000'
 */
export async function cancelAlarmChain(chainId) {
  if (!chainId) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n && n.content && n.content.data && n.content.data.chainId === chainId) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch (error) {
    console.warn('cancelAlarmChain failed:', error.message);
  }
}

/**
 * Handler that stops a ringing alarm: any interaction with a prayer-alarm
 * notification (tap or ⏹ Stop) cancels that occurrence's remaining catch-up
 * rings. Other prayers are never affected.
 * @returns {object} subscription — call .remove() on cleanup
 */
export function registerAlarmStopHandler() {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response && response.notification && response.notification.request
      ? response.notification.request.content.data
      : null;
    if (data && data.kind === 'prayer-alarm' && data.chainId) {
      cancelAlarmChain(data.chainId);
    }
  });
}

/**
 * Ensure the loud alarm channel + stop-action category exist.
 * Uses a NEW channel id ("prayer-alarm-v2") because Android freezes channel
 * settings at creation — devices that already have the legacy channel keep its
 * old (possibly wrong) settings, so a fresh id guarantees correct behaviour.
 */
export async function setupAlarmChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
    name: 'Namaz Alarmları',
    description: 'Prayer time alarms — rings like an alarm clock until turned off.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: HIGH_ALARM_SOUND,
    vibrationPattern: [0, 500, 250, 500, 250, 500],
    lightColor: '#d8b56a',
    enableVibrate: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  try {
    await Notifications.setNotificationCategoryAsync(ALARM_CATEGORY_ID, [
      {
        identifier: 'turn-off',
        buttonTitle: '⏹ Kapat / Stop',
        options: { opensAppToForeground: true },
      },
    ]);
  } catch (error) {
    console.warn('Could not register alarm category:', error.message);
  }
}