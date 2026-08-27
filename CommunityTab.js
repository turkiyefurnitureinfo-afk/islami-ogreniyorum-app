import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { VideoView, useVideoPlayer } from 'expo-video';

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

const CommunityTab = ({
  styles,
  palette,
  t,
  communityPosts,
  newPostText,
  setNewPostText,
  handleCreatePost,
  handleLikePost,
  handleLikeComment,
  newComment,
  setNewComment,
  handlePostComment,
  account,
  handleEditPost,
  handleDeletePost,
  handleEditComment,
  handleDeleteComment,
  onReport,
}) => {
  const [media, setMedia] = useState(null); // { type: 'image'|'video', uri }
  const [pickingMedia, setPickingMedia] = useState(false);
  // Inline edit state: only one field is edited at a time.
  const [editKey, setEditKey] = useState(null); // e.g. 'p-123' or 'c-456'
  const [draftText, setDraftText] = useState('');

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
    handleCreatePost(media);
    setMedia(null);
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
    <ScrollView style={styles.tabContent}>
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

        <Pressable style={styles.communityShareButton} onPress={handleShare}>
          <Text style={styles.communityShareButtonText}>{t?.sharePost || 'Share Post'}</Text>
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
            <Text style={styles.avatar}>{post.user.avatar}</Text>
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
                    <Text style={styles.communityCommentAvatar}>{comment.user.avatar}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.communityCommentUser}>{comment.user.name}</Text>
                      <Text style={styles.communityCommentTime}>{comment.timestamp}</Text>
                    </View>
                    <Pressable onPress={() => reportComment(post, comment)} style={{ padding: 2 }}>
                      <Text style={{ color: '#e05d5d', fontSize: 12 }}>⚑</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.communityCommentText}>{comment.text}</Text>
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