import React from 'react';
import { Pressable, ScrollView, View, Text } from 'react-native';
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
}) => {
  return (
    <ScrollView contentContainerStyle={styles.contentPadding}>
      <View style={styles.card}>
        <View style={styles.locationRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardLabel}>{t.location}</Text>
            <Text style={styles.locationName}>{locationName}</Text>
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
    </ScrollView>
  );
};

export default PrayerTab;