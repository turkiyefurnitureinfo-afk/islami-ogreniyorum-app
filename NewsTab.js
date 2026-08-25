import React from 'react';
import { ScrollView, View, Text, Pressable, Linking } from 'react-native';

const NewsTab = ({ styles, projectEvents, t, newsItems, scholarVideos }) => {
  const items = newsItems && newsItems.length > 0 ? newsItems : null;
  const videos = scholarVideos && scholarVideos.length > 0 ? scholarVideos : null;

  return (
    <ScrollView contentContainerStyle={styles.contentPadding}>
      {/* Live news & events collected from reliable Turkish Muslim sources */}
      {items && (
        <View style={{ marginBottom: 20 }}>
          <Text style={[styles.sectionHeading, { marginTop: 4 }]}>
            {t?.liveNews || 'Haberler & Etkinlikler'}
          </Text>
          {items.map((item, index) => (
            <Pressable
              key={item.id || index}
              style={styles.eventBlock}
              onPress={() => (item.href ? Linking.openURL(item.href) : undefined)}
              disabled={!item.href}
            >
              <Text style={styles.note}>{item.meta}</Text>
              <Text style={styles.versionHeader}>{item.title}</Text>
              {item.source ? <Text style={styles.note}>Kaynak: {item.source}</Text> : null}
            </Pressable>
          ))}
        </View>
      )}

      {/* Live messages from great Islamic scholars on YouTube.
          Tapping a video opens it on YouTube; the channel link opens the
          scholar's channel directly. */}
      {videos && (
        <View style={{ marginBottom: 20 }}>
          <Text style={[styles.sectionHeading, { marginTop: 4 }]}>
            {t?.scholarVideos || '📺 Alimlerden Video Mesajlar'}
          </Text>
          {videos.map((item, index) => (
            <Pressable
              key={item.id || index}
              style={styles.eventBlock}
              onPress={() => (item.href ? Linking.openURL(item.href) : undefined)}
              disabled={!item.href}
            >
              <View style={styles.videoRow}>
                <View style={styles.playBadge}>
                  <Text style={styles.playBadgeText}>▶</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.versionHeader} numberOfLines={2}>{item.title}</Text>
                  <Text style={styles.note}>
                    {item.source}
                    {item.meta ? ` • ${item.meta}` : ''}
                  </Text>
                </View>
              </View>
              {item.channelHref ? (
                <Pressable
                  style={styles.channelLink}
                  onPress={() => Linking.openURL(item.channelHref)}
                >
                  <Text style={styles.channelLinkText}>
                    {t?.openChannel || 'Kanalı aç →'}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      {/* Project developments changelog */}
      <Text style={styles.sectionHeading}>{t.projectDevelopments}</Text>
      {projectEvents.map(event => (
        <View key={event.version} style={styles.eventBlock}>
          <Text style={styles.versionHeader}>{event.version} / {event.date}</Text>
          <View style={styles.notesList}>
            {event.notes.map((note, index) => (
              <Text key={index} style={styles.note}>• {note}</Text>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
};

export default NewsTab;