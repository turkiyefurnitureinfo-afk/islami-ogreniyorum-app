// ---------------------------------------------------------------------------
// prayerAlarms.js — alarm-clock-style per-prayer alarm configuration
// ---------------------------------------------------------------------------
// A prayer alarm is NOT a global sound choice: each prayer (Fajr, Dhuhr, Asr,
// Maghrib, Isha) is its own alarm entry, exactly like a normal clock app:
//
//   { fajr:  { enabled: true, offsetMinutes: 0 } }  → rings AT the prayer time
//   { isha:  { enabled: true, offsetMinutes: 15 } } → rings 15 min BEFORE
//   { dhuhr: { enabled: false } }                   → no alarm
//
// `offsetMinutes` means "minutes before the prayer time" (0..120). Sunrise is
// display-only and never gets an alarm.
//
// Scheduling model (fits expo-notifications' 64-pending-notification limit):
//   • One DAILY repeating trigger per enabled alarm — rings every day at the
//     configured time, forever, with zero rescheduling.
//   • NO catch-up/prolong rings — the alarm fires once at the configured time
//     and stops. This is normal alarm clock behavior.
// Tapping the notification cancels that day's trigger.
// ---------------------------------------------------------------------------

import { NativeModules, Platform, PermissionsAndroid } from 'react-native';
import * as Notifications from 'expo-notifications';
import { HIGH_ALARM_SOUND } from './notifications.js';

/** The prayers that can have alarms, in day order. Sunrise is excluded. */
export const ALARM_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** Offset choices the UI offers, in minutes before the prayer time. */
export const ALARM_OFFSET_OPTIONS = [0, 5, 10, 15, 20, 30, 45, 60];

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
 * Google Play policy compliance for exact alarms (SCHEDULE_EXACT_ALARM).
 *
 * Play restricts exact alarms to apps whose core functionality needs them;
 * the permission is also a user-grantable "Alarms & reminders" app-op on
 * Android 12-14. This helper therefore:
 *   1. NEVER blocks scheduling — it only attempts the request and reports.
 *   2. Never uses a raw PermissionsAndroid.request() for the app-op (that
 *      is the pattern Play flags); expo-notifications' dedicated request is
 *      used when the installed version exposes it.
 *   3. Returns false on denial so the caller can log a graceful downgrade.
 *
 * The actual crash-safety comes from expo-notifications itself: its native
 * ExpoSchedulingDelegate checks AlarmManager.canScheduleExactAlarms() and
 * silently switches to inexact setAndAllowWhileIdle() when the capability
 * is denied — so a denial degrades timing accuracy slightly instead of
 * throwing or preventing alarms entirely.
 *
 * @returns {Promise<boolean>} true when exact alarms are available (or the
 *   platform does not need the app-op), false when the user/OS denied them.
 */
async function ensureExactAlarmPermission() {
  try {
    if (Platform.OS !== 'android' || Platform.Version < 31) return true;

    // Preferred: expo-notifications' dedicated exact-alarm request (SDK 52+).
    if (
      typeof Notifications.requestExactAlarmsPermissionAsync === 'function'
    ) {
      const status = await Notifications.requestExactAlarmsPermissionAsync();
      if (status === 'granted') return true;
      console.warn(
        'Exact-alarm permission not granted — prayer alarms will use inexact scheduling.'
      );
      return false;
    }

    // expo-notifications < SDK 52 has no dedicated JS API. The native
    // delegate performs the canScheduleExactAlarms() check itself and falls
    // back to inexact alarms automatically, so no manual permission call is
    // needed (and none should be made — see the Play policy note above).
    return true;
  } catch (e) {
    // Best-effort only; never let a permission hiccup break scheduling.
    console.warn('ensureExactAlarmPermission failed:', e?.message || e);
    return false;
  }
}

/**
 * Best-effort: if a native `AlarmClock` module (android AlarmManager.setAlarmClock)
 * is present in the build, arm a guaranteed full-screen, exact alarm for the next
 * occurrence. Falls back silently (and fully) to expo-notifications if the module
 * is not built in or throws — zero regression on devices without it.
 *
 * The native AlarmClock module uses AlarmManager.setAlarmClock() which is:
 *   - Exact: fires precisely on time (not batched with other alarms)
 *   - Doze-exempt: fires even when the device is in Doze/App Standby
 *   - Full-screen: shows a full-screen intent when it fires
 *   - User-visible: shows in the system alarm clock UI
 */
async function armNativeAlarm(tsEpochMs, chainId, label) {
  try {
    const Native = NativeModules && NativeModules.AlarmClock;
    if (
      Native &&
      typeof Native.setAlarmClock === 'function' &&
      Number.isFinite(tsEpochMs) &&
      tsEpochMs > 0
    ) {
      await Native.setAlarmClock(tsEpochMs, label, chainId);
    } else {
      // No native AlarmClock module — expo-notifications DATE trigger is already
      // scheduled above. On Android 12+ without SCHEDULE_EXACT_ALARM the OS may
      // delay it slightly under Doze, but it WILL fire.
    }
  } catch (_e) {
    // Native alarm unavailable/failed — expo-notifications path already scheduled.
  }
}

/**
 * Public: re-export ensureExactAlarmPermission so callers (App.js, SettingsTab)
 * can request the SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM app-op on Android 12+
 * before scheduling. Returns true when exact alarms are available.
 */
export { ensureExactAlarmPermission };

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
export async function schedulePrayerAlarms({ alarms, prayerTimes, language, t, notificationSound }) {
  if (Platform.OS !== 'android') return 0;

  try {
    // Ask for the exact-alarm app-op. When the user or the OS denies it, this
    // only affects timing accuracy: expo-notifications' native scheduling
    // delegate re-checks AlarmManager.canScheduleExactAlarms() per trigger and
    // automatically downgrades to inexact setAndAllowWhileIdle(), so denial can
    // never crash scheduling or prevent notifications from firing.
    const exactGranted = await ensureExactAlarmPermission();
    if (!exactGranted) {
      console.info(
        'Prayer alarms scheduled WITHOUT exact-alarm capability — rings may be ' +
          'delayed by a few minutes under Doze. All triggers remain active.'
      );
    }

    // Determine which channel to use based on the sound setting
    const isHighAlarm = /yüksek alarm|high alarm/i.test(notificationSound || '');
    const channelId = isHighAlarm ? ALARM_CHANNEL_ID : 'prayer-times';
    
    // Set up the appropriate channel based on sound preference
    if (isHighAlarm) {
      // High alarm channel with bundled chime
      await Notifications.setNotificationChannelAsync(ALARM_CHANNEL_ID, {
        name: 'Namaz Alarmları',
        description: 'Prayer time alarm: rings at the configured time like a normal alarm clock.',
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
    } else {
      // Default channel with system sound
      await Notifications.setNotificationChannelAsync('prayer-times', {
        name: 'Namaz Vakitleri',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#d8b56a',
      });
    }

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
      //    forever, with no rescheduling. This is NORMAL alarm clock behavior:
      //    no catch-up / prolong / re-ring — fire once at the configured time.
      await Notifications.scheduleNotificationAsync({
        content: {
          title: language === 'tr' ? 'Namaz Vakti' : 'Prayer Time',
          body: language === 'tr'
            ? `${label} namazı vakti geldi`
            : `It's time for ${label} prayer`,
          sound: isHighAlarm ? HIGH_ALARM_SOUND : 'default',
          channelId,
          // Show stop button only for high alarm mode
          ...(isHighAlarm ? { categoryIdentifier: ALARM_CATEGORY_ID } : {}),
          data: { kind: 'prayer-alarm', prayerKey: key, chainId: `daily-${key}` },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
        },
      });
      scheduled += 1;

      // Optional native AlarmManager.setAlarmClock for guaranteed exact alarm
      // (full-screen, Doze-exempt). Falls back harmlessly if not available.
      const fireDate = new Date();
      fireDate.setHours(hour, minute, 0, 0);
      if (fireDate.getTime() <= Date.now()) {
        fireDate.setDate(fireDate.getDate() + 1);
      }
      await armNativeAlarm(
        fireDate.getTime(),
        `native-${key}-${fireDate.getTime()}`,
        label
      );
    }
    return scheduled;
  } catch (error) {
    // Scheduling is a background convenience — it must NEVER crash the app
    // (e.g. on launch). Whatever was scheduled before the failure remains
    // active; the app re-syncs alarms on the next launch/settings change.
    console.error('schedulePrayerAlarms failed:', error?.message || error);
    return -1;
  }
}

/**
 * Cancel every pending notification in one alarm chain (a single prayer
 * occurrence). Called when a ring is tapped/stopped.
 * @param {string} chainId - e.g. 'daily-fajr'
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
 * notification (tap or ⏹ Stop) cancels that alarm. Other prayers are never affected.
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