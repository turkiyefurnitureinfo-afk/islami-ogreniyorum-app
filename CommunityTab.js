import React, { useState, useCallback } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Image, ActivityIndicator, RefreshControl } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';
import { TranslateButton } from './useTranslate.js';
import { useCachedAvatar } from './avatarCache.js';

/** Single post video player (hook requires its own component instance). */
function PostVideo({ uri, style }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.muted = false;
  });
  return (
    <VideoView
      player={player}
      style={style}
      contentFit="cover"
      allowsFullscreen
      allowsPictureInPicture
    />
  );
}

/**
 * Avatar that renders from the on-disk cache first (works offline). The emoji
 * fallback only appears when the user genuinely has no profile picture. When a
 * URL exists but can't load (e.g. offline + uncached), a neutral placeholder
 * shows instead of a broken image or the emoji.
 */
function AvatarImage({ url, fallback, style }) {
  const cached = useCachedAvatar(url);
  const src = cached || url;
  const [errored, setErrored] = useState(false);
  if (src) {
    // Reset error flag when the source changes so a new URL gets a fresh attempt.
    if (errored) setErrored(false);
    return (
      <Image
        source={{ uri: src }}
        style={style}
        onError={() => setErrored(true)}
      />
    );
  }
  // No source at all (genuinely no avatar) → emoji fallback.
  if (!url) {
    return <Text style={style}>{fallback}</Text>;
  }
  // URL exists but the image failed to load (offline + uncached) → neutral
  // placeholder, NOT the emoji. The emoji is reserved for "no picture at all".
  return (
    <View style={style}>
      <Text style={{ fontSize: 16, opacity: 0.4 }}>👤</Text>
    </View>
  );
}

const CommunityTab = ({
  styles,
  palette,
  t,
  language,
  communityPosts,
  newPostText,
  setNewPostText,
  handleCreatePost,
  sharingPost,
  handleLikePost,
  handleLikeComment,
  newComment,
  setNewComment,
  handlePostComment,
  account,
  profilePicture,
  handleEditPost,
  handleDeletePost,
  handleEditComment,
  handleDeleteComment,
  onReport,
  onRefresh, // Pull-to-refresh callback
}) => {
  const [media, setMedia] = useState(null); // { type: 'image'|'video', uri }
  const [pickingMedia, setPickingMedia] = useState(false);
  // Inline edit state: only one field is edited at a time.
  const [editKey, setEditKey] = useState(null); // e.g. 'p-123' or 'c-456'
  const [draftText, setDraftText] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const onRefreshInternal = useCallback(async () => {
    setRefreshing(true);
    try {
      if (onRefresh) await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const isOwn = (ownerEmail) =>
    !!ownerEmail && !!account?.email && ownerEmail === account.email;

  const startEdit = (key, currentText) => {
    setEditKey(key);
    setDraftText(currentText);
  };

  const cancelEdit = () => {
    setEditKey(null);
    setDraftText('');
  };

  /**
   * Renders ✏️ Edit / 🗑 Delete controls for the user's own content, or the
   * inline edit form when that item is being edited. Returns null otherwise.
   */
  const renderOwnerControls = (key, ownerEmail, originalText, onSave, onDelete) => {
    if (!isOwn(ownerEmail)) return null;
    if (editKey === key) {
      return (
        <View>
          <TextInput
            style={styles.contentEditInput}
            value={draftText}
            onChangeText={setDraftText}
            multiline
            autoFocus
          />
          <View style={styles.contentEditBtnRow}>
            <Pressable
              style={styles.contentEditSaveBtn}
              onPress={() => { onSave(draftText); cancelEdit(); }}
            >
              <Text style={styles.contentEditSaveText}>{t?.save || 'Save'}</Text>
            </Pressable>
            <Pressable style={styles.contentEditCancelBtn} onPress={cancelEdit}>
              <Text style={styles.contentEditCancelText}>{t?.cancel || 'Cancel'}</Text>
            </Pressable>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.contentActionRow}>
        <Pressable onPress={() => startEdit(key, originalText)}>
          <Text style={styles.contentActionEdit}>✏️ {t?.edit || 'Edit'}</Text>
        </Pressable>
        <Pressable onPress={onDelete}>
          <Text style={styles.contentActionDelete}>🗑 {t?.delete || 'Delete'}</Text>
        </Pressable>
      </View>
    );
  };

  const pickImage = async () => {
    setPickingMedia(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setMedia({ type: 'image', uri: result.assets[0].uri });
      }
    } catch (error) {
      console.error('Error picking image:', error);
    } finally {
      setPickingMedia(false);
    }
  };

  const pickVideo = async () => {
    setPickingMedia(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: true,
        quality: 0.8,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setMedia({ type: 'video', uri: result.assets[0].uri });
      }
    } catch (error) {
      console.error('Error picking video:', error);
    } finally {
      setPickingMedia(false);
    }
  };

  const handleShare = () => {
    handleCreatePost(media).finally(() => setMedia(null));
  };

  // Moderation: hand the item up to App's confirm dialog (report / block).
  const reportPost = (post) => onReport?.({
    contentType: 'post',
    contentId: String(post.id),
    authorEmail: post.ownerEmail,
  });
  const reportComment = (post, comment) => onReport?.({
    contentType: 'comment',
    contentId: comment.id,
    authorEmail: comment.commenterEmail,
    parentPostId: post.id,
  });

  const handleBlockUser = (userName) => {
    // TODO: Store blocked users and filter their content
    console.log(`Blocked user: ${userName}`);
  };

  return (
    <ScrollView 
      style={styles.tabContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefreshInternal}
          tintColor={palette.accent}
          colors={[palette.accent]}
        />
      }
    >
      {/* Create Post */}
      <View style={styles.communityCreateCard}>
        <Text style={styles.communityCreateTitle}>{t?.createPost || 'Create Post'}</Text>
        <TextInput
          style={styles.communityPostInput}
          placeholder={t?.postPlaceholder || 'What would you like to share?'}
          placeholderTextColor={palette.muted}
          value={newPostText}
          onChangeText={setNewPostText}
          multiline
        />

        <View style={styles.communityMediaRow}>
          <Pressable style={styles.communityMediaButton} onPress={pickImage} disabled={pickingMedia}>
            <Text style={styles.communityMediaButtonText}>{t?.addPhoto || '📷 Add Photo'}</Text>
          </Pressable>
          <Pressable style={styles.communityMediaButton} onPress={pickVideo} disabled={pickingMedia}>
            <Text style={styles.communityMediaButtonText}>{t?.addVideo || '🎥 Add Video'}</Text>
          </Pressable>
        </View>

        {pickingMedia && <ActivityIndicator size="small" color={palette.primary} style={{ marginBottom: 10 }} />}

        {media && (
          <View style={styles.communityMediaPreview}>
            {media.type === 'image' ? (
              <Image source={{ uri: media.uri }} style={styles.communityMediaImage} />
            ) : (
              <PostVideo uri={media.uri} style={styles.communityMediaVideo} />
            )}
            <Pressable onPress={() => setMedia(null)}>
              <Text style={styles.communityMediaRemove}>✕ {t?.removeMedia || 'Remove Media'}</Text>
            </Pressable>
          </View>
        )}

        <Pressable
          style={[styles.communityShareButton, sharingPost && styles.disabledButton]}
          onPress={handleShare}
          disabled={sharingPost}
        >
          {sharingPost ? (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color="#08131a" style={{ marginRight: 8 }} />
              <Text style={styles.communityShareButtonText}>{t?.sharingPost || 'Sharing...'}</Text>
            </View>
          ) : (
            <Text style={styles.communityShareButtonText}>{t?.sharePost || 'Share Post'}</Text>
          )}
        </Pressable>
      </View>

      {/* Content Moderation Notice */}
      <View style={styles.communityCreateCard}>
        <Text style={styles.communityMediaBadge}>
          {t?.moderationNotice || '⚠️ Be respectful. Inappropriate content will be removed. Report abusive content using the ⚑ button.'}
        </Text>
      </View>

      {/* Posts Feed */}
      {communityPosts.map((post) => (
        <View key={post.id} style={styles.card}>
          <View style={styles.postHeader}>
            <AvatarImage
              url={post.user.avatarUrl}
              fallback={post.user.avatar}
              style={[styles.avatar, styles.communityAvatarImage]}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.postUser}>{post.user.name}</Text>
              <Text style={styles.postTime}>{post.timestamp}</Text>
            </View>
            <Pressable onPress={() => reportPost(post)} style={{ padding: 4 }}>
              <Text style={{ color: '#e05d5d', fontSize: 14 }}>⚑</Text>
            </Pressable>
            <Pressable onPress={() => handleBlockUser(post.user.name)} style={{ padding: 4 }}>
              <Text style={{ color: palette.muted, fontSize: 12 }}>⛔</Text>
            </Pressable>
          </View>

          <Text style={styles.communityPostText}>{post.text}</Text>
          <TranslateButton text={post.text} t={t} uiLang={language} />

          {renderOwnerControls(
            'p-' + post.id,
            post.ownerEmail,
            post.text,
            (text) => handleEditPost(post.id, text),
            () => handleDeletePost(post.id)
          )}

          {post.media && (
            <View style={styles.communityPostMedia}>
              {post.media.type === 'image' ? (
                <Image source={{ uri: post.media.uri }} style={styles.communityPostImage} />
              ) : (
                <View>
                  <Text style={styles.communityMediaBadge}>🎥 {t?.video || 'Video'}</Text>
                  <PostVideo uri={post.media.uri} style={styles.communityPostVideo} />
                </View>
              )}
            </View>
          )}

          {/* Post actions: like & comment count */}
          <View style={styles.communityPostActions}>
            <Pressable onPress={() => handleLikePost(post.id)}>
              <Text style={[styles.communityPostLike, post.likedByMe && styles.communityPostLikeLiked]}>
                {post.likedByMe ? '❤️' : '🤍'} {post.likes} {t?.likePost || 'Like'}
              </Text>
            </Pressable>
            <Text style={styles.communityPostCommentCount}>
              💬 {post.comments?.length || 0} {t?.comments || 'comments'}
            </Text>
          </View>

          {/* Comments section */}
          <View style={styles.communityCommentsSection}>
            {post.comments && post.comments.length > 0 ? (
              post.comments.map((comment) => (
                <View key={comment.id} style={styles.communityCommentItem}>
                  <View style={styles.communityCommentHeader}>
                    <AvatarImage
                      url={comment.user.avatarUrl}
                      fallback={comment.user.avatar}
                      style={[styles.communityCommentAvatar, styles.communityAvatarImageSmall]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.communityCommentUser}>{comment.user.name}</Text>
                      <Text style={styles.communityCommentTime}>{comment.timestamp}</Text>
                    </View>
                    <Pressable onPress={() => reportComment(post, comment)} style={{ padding: 2 }}>
                      <Text style={{ color: '#e05d5d', fontSize: 12 }}>⚑</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.communityCommentText}>{comment.text}</Text>
                  <TranslateButton text={comment.text} t={t} uiLang={language} />
                  <View style={styles.communityCommentFooter}>
                    <Text style={styles.communityCommentTime}>{comment.timestamp}</Text>
                    <Pressable onPress={() => handleLikeComment(post.id, comment.id)}>
                      <Text style={[styles.communityCommentLike, comment.likedByMe && styles.communityCommentLikeLiked]}>
                        {comment.likedByMe ? '❤️' : '🤍'} {comment.likes}
                      </Text>
                    </Pressable>
                  </View>
                  {renderOwnerControls(
                    'c-' + comment.id,
                    comment.commenterEmail,
                    comment.text,
                    (text) => handleEditComment(post.id, comment.id, text),
                    () => handleDeleteComment(post.id, comment.id)
                  )}
                </View>
              ))
            ) : (
              <Text style={styles.communityNoComments}>{t?.noCommentsYet || 'No comments yet. Be the first to comment!'}</Text>
            )}

            {/* Add comment */}
            <View style={styles.communityCommentInputRow}>
              <TextInput
                style={styles.communityCommentInput}
                placeholder={t?.writeComment || 'Write a comment...'}
                placeholderTextColor={palette.muted}
                value={newComment[post.id] || ''}
                onChangeText={(text) => setNewComment((prev) => ({ ...prev, [post.id]: text }))}
              />
              <Pressable style={styles.communityCommentSubmit} onPress={() => handlePostComment(post.id)}>
                <Text style={styles.communityCommentSubmitText}>{t?.postComment || 'Comment'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
};

export default CommunityTab;