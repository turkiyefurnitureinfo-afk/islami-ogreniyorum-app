import React from 'react';
import { ScrollView, View, Text, Switch, Pressable } from 'react-native';
import { fmt } from './utils.js';
import { ALARM_OFFSET_OPTIONS } from './prayerAlarms.js';

const PrayerTab = ({
  styles,
  t,
  nextPrayer,
  times,
  diffHours,
  diffMinutes,
  diffSeconds,
  locationName,
  locating,
  locationError,
  onDetectLocation,
  sourceLabel,
  language,
  palette,
  prayerAlarms,
  setPrayerAlarms,
  notificationsOn,
}) => {
  // Defensive defaults: this tab is the FIRST screen every new user lands on
  // after the welcome flow, so it must never crash on malformed props.
  // - `times` can be null when the on-device computation fails (computeTimes
  //   returns null on invalid input) — render placeholders instead of throwing.
  // - `nextPrayer` is always an object from App.js, but guard anyway.
  const safeTimes = times && typeof times === 'object' ? times : {};
  const safeNext =
    nextPrayer && typeof nextPrayer === 'object'
      ? nextPrayer
      : { key: 'fajr', time: safeTimes.fajr || 0 };
  const nextKey = typeof safeNext.key === 'string' ? safeNext.key : 'fajr';
  const nextTime = Number.isFinite(safeNext.time) ? safeNext.time : safeTimes[nextKey];
  // Timer text: never render "NaN" — fall back to 00.
  const pad2 = (v) => {
    const n = Math.floor(Number(v));
    return String(Number.isFinite(n) && n >= 0 ? n : 0).padStart(2, '0');
  };
  return (
    <ScrollView contentContainerStyle={styles.contentPadding}>
      <View style={styles.card}>
        <View style={styles.locationRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>{t?.location || 'Location'}</Text>
            <Text style={styles.locationName}>{locationName}</Text>
            {!!sourceLabel && (
              <Text style={styles.settingValue}>{sourceLabel}</Text>
            )}
            {!!locationError && (
              <Text style={styles.locationErrorText}>{locationError}</Text>
            )}
          </View>
          <Pressable
            style={[styles.locationButton, locating && styles.disabledButton]}
            onPress={onDetectLocation}
            disabled={locating}
          >
            <Text style={styles.locationButtonText}>
              {locating ? (t?.detecting || 'Detecting...') : (t?.detectLocation || 'Detect Location')}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTag}>{t?.nextPrayer || 'Next Prayer'}</Text>
        <View style={styles.clearRow}>
          <View>
            <Text style={styles.cardLabel}>{t?.[nextKey] || t?.fajr || 'Fajr'}</Text>
            <Text style={styles.primaryPrayer}>{fmt(nextTime)}</Text>
          </View>
          <View style={styles.rightAligned}>
            <Text style={styles.cardLabel}>{t?.remaining || 'Remaining'}</Text>
            <Text style={styles.timerText}>
              {pad2(diffHours)}:{pad2(diffMinutes)}:{pad2(diffSeconds)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.listWrap}>
        {[
          { key: 'fajr', label: t?.fajr || 'Fajr' },
          { key: 'sunrise', label: t?.sunrise || 'Sunrise' },
          { key: 'dhuhr', label: t?.dhuhr || 'Dhuhr' },
          { key: 'asr', label: t?.asr || 'Asr' },
          { key: 'maghrib', label: t?.maghrib || 'Maghrib' },
          { key: 'isha', label: t?.isha || 'Isha' },
        ].map((item) => {
          const isSunrise = item.key === 'sunrise';
          const entry = (prayerAlarms && prayerAlarms[item.key]) || null;
          const cfg = entry || { enabled: false, offsetMinutes: 0 };
          const prayer = Number(safeTimes[item.key]);
          const hasPrayer = Number.isFinite(prayer);
          const fire =
            entry && hasPrayer
              ? Math.max(0, prayer - (cfg.offsetMinutes || 0))
              : hasPrayer
                ? prayer
                : 0;
          return (
            <View key={item.key} style={styles.rowItem}>
              <View style={styles.leftGroup}>
                <View style={[styles.dot, nextKey === item.key && styles.dotActive]} />
                <Text style={styles.rowLabel}>{item.label}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.rowTime}>{fmt(prayer)}</Text>
                {!isSunrise && (
                  <>
                    <Switch
                      style={{ marginLeft: 10 }}
                      value={!!cfg.enabled}
                      onValueChange={(v) => setPrayerAlarms((prev) => ({
                        ...(prev || {}),
                        [item.key]: {
                          ...(prev && prev[item.key]),
                          enabled: v,
                          offsetMinutes: (prev && prev[item.key] && prev[item.key].offsetMinutes) || 0,
                        },
                      }))}
                      trackColor={palette ? { false: palette.muted, true: palette.accent } : undefined}
                      disabled={!notificationsOn}
                    />
                    {cfg.enabled && (
                      <View style={styles.offsetSelector}>
                        {ALARM_OFFSET_OPTIONS.map((offset) => (
                          <Pressable
                            key={offset}
                            onPress={() => setPrayerAlarms((prev) => ({
                              ...prev,
                              [item.key]: { ...(prev && prev[item.key]), enabled: true, offsetMinutes: offset },
                            }))}
                            style={[
                              styles.offsetChip,
                              cfg.offsetMinutes === offset && styles.offsetChipActive,
                            ]}
                          >
                            <Text style={[
                              styles.offsetChipText,
                              cfg.offsetMinutes === offset && styles.offsetChipTextActive,
                            ]}>
                              {language === 'tr' ? `${offset} dk önce` : `${offset} min before`}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </>
                )}
              </View>
            </View>
          );
        })}
      </View>

    </ScrollView>
  );
};

export default PrayerTab;
