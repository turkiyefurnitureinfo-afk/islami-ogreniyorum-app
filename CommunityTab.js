import React, { useState } from 'react';
import { ScrollView, View, Text, TextInput, Pressable, Image, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Video } from 'expo-av';

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
}) => {
  const [media, setMedia] = useState(null); // { type: 'image'|'video', uri }
  const [pickingMedia, setPickingMedia] = useState(false);

  const pickImage = async () => {
    setPickingMedia(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
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
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
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

  const handleReportPost = (postId) => {
    // TODO: Send report to backend moderation system
    console.log(`Reported post: ${postId}`);
  };

  const handleReportComment = (postId, commentId) => {
    // TODO: Send report to backend moderation system
    console.log(`Reported comment: ${postId}/${commentId}`);
  };

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
              <Video
                source={{ uri: media.uri }}
                style={styles.communityMediaVideo}
                useNativeControls
                resizeMode="cover"
              />
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
            <Pressable onPress={() => handleReportPost(post.id)} style={{ padding: 4 }}>
              <Text style={{ color: '#e05d5d', fontSize: 14 }}>⚑</Text>
            </Pressable>
            <Pressable onPress={() => handleBlockUser(post.user.name)} style={{ padding: 4 }}>
              <Text style={{ color: palette.muted, fontSize: 12 }}>⛔</Text>
            </Pressable>
          </View>

          <Text style={styles.communityPostText}>{post.text}</Text>

          {post.media && (
            <View style={styles.communityPostMedia}>
              {post.media.type === 'image' ? (
                <Image source={{ uri: post.media.uri }} style={styles.communityPostImage} />
              ) : (
                <View>
                  <Text style={styles.communityMediaBadge}>🎥 {t?.video || 'Video'}</Text>
                  <Video
                    source={{ uri: post.media.uri }}
                    style={styles.communityPostVideo}
                    useNativeControls
                    resizeMode="cover"
                  />
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
                    <Pressable onPress={() => handleReportComment(post.id, comment.id)} style={{ padding: 2 }}>
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