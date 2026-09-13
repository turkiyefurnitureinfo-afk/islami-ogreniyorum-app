import React from 'react';
import { ScrollView, View, Text, Switch } from 'react-native';
import { fmt } from './utils.js';

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
            <Text style={styles.cardLabel}>{t?.[nextPrayer.key] || t?.fajr || 'Fajr'}</Text>
            <Text style={styles.primaryPrayer}>{fmt(nextPrayer.time)}</Text>
          </View>
          <View style={styles.rightAligned}>
            <Text style={styles.cardLabel}>{t?.remaining || 'Remaining'}</Text>
            <Text style={styles.timerText}>
              {String(diffHours).padStart(2, '0')}:{String(diffMinutes).padStart(2, '0')}:{String(diffSeconds).padStart(2, '0')}
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
          const fire = entry && Number.isFinite(times && times[item.key])
            ? Math.max(0, times[item.key] - (cfg.offsetMinutes || 0))
            : (times ? times[item.key] : 0);
          return (
            <View key={item.key} style={styles.rowItem}>
              <View style={styles.leftGroup}>
                <View style={[styles.dot, nextPrayer.key === item.key && styles.dotActive]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  {!isSunrise && notificationsOn && cfg.enabled && (
                    <Text style={[styles.settingValue, { marginTop: 1 }]}>
                      {language === 'tr'
                        ? `⏰ ${fmt(fire)}${cfg.offsetMinutes ? ` (${cfg.offsetMinutes} dk önce)` : ''}`
                        : `⏰ ${fmt(fire)}${cfg.offsetMinutes ? ` (${cfg.offsetMinutes} min before)` : ''}`}
                    </Text>
                  )}
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.rowTime}>{fmt(times[item.key])}</Text>
                {!isSunrise && (
                  <Switch
                    style={{ marginLeft: 10 }}
                    value={!!cfg.enabled}
                    onValueChange={(v) => setPrayerAlarms((prev) => ({
                      ...prev,
                      [item.key]: {
                        ...(prev && prev[item.key]),
                        enabled: v,
                        offsetMinutes: (prev && prev[item.key] && prev[item.key].offsetMinutes) || 0,
                      },
                    }))}
                    trackColor={palette ? { false: palette.muted, true: palette.accent } : undefined}
                    disabled={!notificationsOn}
                  />
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
