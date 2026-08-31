import React, { useState } from 'react';
import { Pressable, ScrollView, View, Text, Switch } from 'react-native';
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
  return (
    <ScrollView contentContainerStyle={styles.contentPadding}>
      <View style={styles.card}>
        <View style={styles.locationRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>{t.location}</Text>
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
              {locating ? t.detecting : t.detectLocation}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTag}>{t.nextPrayer}</Text>
        <View style={styles.clearRow}>
          <View>
            <Text style={styles.cardLabel}>{t[nextPrayer.key] || t.fajr}</Text>
            <Text style={styles.primaryPrayer}>{fmt(nextPrayer.time % 1440)}</Text>
          </View>
          <View style={styles.rightAligned}>
            <Text style={styles.cardLabel}>{t.remaining}</Text>
            <Text style={styles.timerText}>
              {String(diffHours).padStart(2, '0')}:{String(diffMinutes).padStart(2, '0')}:{String(diffSeconds).padStart(2, '0')}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.listWrap}>
        {[
          { key: 'fajr', label: t.fajr },
          { key: 'sunrise', label: t.sunrise },
          { key: 'dhuhr', label: t.dhuhr },
          { key: 'asr', label: t.asr },
          { key: 'maghrib', label: t.maghrib },
          { key: 'isha', label: t.isha },
        ].map((item) => (
          <View key={item.key} style={styles.rowItem}>
            <View style={styles.leftGroup}>
              <View style={[styles.dot, nextPrayer.key === item.key && styles.dotActive]} />
              <Text style={styles.rowLabel}>{item.label}</Text>
            </View>
            <Text style={styles.rowTime}>{fmt(times[item.key])}</Text>
          </View>
        ))}
      </View>

      {/* ---- Alarm clock panel: one alarm per prayer ---- */}
      <View style={styles.card}>
        <View style={styles.sectionHeaderRow || { marginBottom: 8 }}>
          <Text style={styles.cardLabel}>
            {language === 'tr' ? '⏰ Namaz Alarmları' : '⏰ Prayer Alarms'}
          </Text>
          <Text style={styles.settingValue}>
            {notificationsOn
              ? (language === 'tr' ? 'Her namaz için ayrı alarm' : 'A separate alarm for each prayer')
              : (language === 'tr' ? 'Bildirimler kapalı — Ayarlar’dan açın' : 'Notifications are off — enable them in Settings')}
          </Text>
        </View>

        {['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map((key) => {
          const entry = (prayerAlarms && prayerAlarms[key]) || null;
          const isSunrise = key === 'sunrise';
          const cfg = entry || { enabled: false, offsetMinutes: 0 };
          const label = t[key] || key;
          // The fire time shown = prayer time minus the chosen offset.
          const fire = entry && Number.isFinite(times && times[key])
            ? Math.max(0, times[key] - (cfg.offsetMinutes || 0))
            : (times ? times[key] : 0);
          const offsets = isSunrise ? [] : ALARM_OFFSET_OPTIONS;
          return (
            <View
              key={`alarm-${key}`}
              style={[styles.rowItem, { alignItems: 'flex-start', paddingVertical: 8 }]}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={[styles.rowLabel, { opacity: cfg.enabled ? 1 : 0.55 }]}>
                    {isSunrise ? label : `⏰ ${label}`}
                  </Text>
                </View>
                {!isSunrise && (
                  <Text style={[styles.settingValue, { marginTop: 2 }]}>
                    {cfg.enabled
                      ? (language === 'tr'
                          ? `Çalma saati ${fmt(fire)}${cfg.offsetMinutes ? ` (${cfg.offsetMinutes} dk önce)` : ''}`
                          : `Rings at ${fmt(fire)}${cfg.offsetMinutes ? ` (${cfg.offsetMinutes} min before)` : ''}`)
                      : (language === 'tr' ? 'Alarm kapalı' : 'Alarm off')}
                  </Text>
                )}
                {/* Offset chips (hidden for sunrise) */}
                {!isSunrise && cfg.enabled && (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                    {offsets.map((m) => (
                      <Pressable
                        key={`off-${key}-${m}`}
                        onPress={() => setPrayerAlarms((prev) => ({
                          ...prev,
                          [key]: { ...(prev && prev[key]), enabled: true, offsetMinutes: m },
                        }))}
                        style={[
                          styles.modeButton,
                          { paddingHorizontal: 10, paddingVertical: 4, marginRight: 6, marginTop: 4 },
                          cfg.offsetMinutes === m && styles.modeButtonActive,
                        ]}
                      >
                        <Text style={styles.modeButtonText}>
                          {m === 0 ? (language === 'tr' ? 'Vaktinde' : 'At time') : `-${m}m`}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
              {!isSunrise && (
                <Switch
                  value={!!cfg.enabled}
                  onValueChange={(v) => setPrayerAlarms((prev) => ({
                    ...prev,
                    [key]: { ...(prev && prev[key]), enabled: v, offsetMinutes: (prev && prev[key] && prev[key].offsetMinutes) || 0 },
                  }))}
                  trackColor={palette ? { false: palette.muted, true: palette.accent } : undefined}
                />
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
};

export default PrayerTab;